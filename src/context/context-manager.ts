import type { Message, ContextConfig, CompressionResult } from './types.js';
import { TokenEstimator } from './token-estimator.js';

export class ContextManager {
  private config: ContextConfig;
  private tokenEstimator: TokenEstimator;
  
  constructor(config: Partial<ContextConfig> = {}) {
    this.config = {
      maxContextTokens: 8192, // Default for 8K models
      reservedTokens: 1000,   // For system prompt, tools, response
      compressionStrategy: 'hybrid',
      keepFirstLast: true,
      maxMessagesToKeep: 20,
      ...config
    };
    this.tokenEstimator = new TokenEstimator();
  }
  
  async compressHistory(
    messages: Message[],
    systemPrompt: string = '',
    modelId?: string
  ): Promise<CompressionResult> {
    // Use model-specific estimator if provided
    const estimator = modelId 
      ? TokenEstimator.createForModel(modelId)
      : this.tokenEstimator;
    
    const systemTokens = estimator.estimate(systemPrompt);
    const availableTokens = this.config.maxContextTokens - 
                           this.config.reservedTokens - 
                           systemTokens;
    
    // Calculate current token count
    const originalTokens = messages.reduce((sum, msg) => 
      sum + estimator.estimateMessageWithRole(msg), 0);
    
    if (originalTokens <= availableTokens) {
      return {
        messages,
        originalTokenCount: originalTokens,
        compressedTokenCount: originalTokens,
        compressionRatio: 1.0,
        removedMessages: 0,
        strategyUsed: 'none'
      };
    }
    
    // Apply compression based on strategy
    let compressed: Message[];
    let strategy: string;
    
    switch (this.config.compressionStrategy) {
      case 'truncate':
        compressed = this.truncateHistory(messages, availableTokens, estimator);
        strategy = 'truncate';
        break;
        
      case 'selective':
        compressed = this.selectiveCompression(messages, availableTokens, estimator);
        strategy = 'selective';
        break;
        
      case 'hybrid':
      default:
        compressed = this.hybridCompression(messages, availableTokens, estimator);
        strategy = 'hybrid';
        break;
    }
    
    const compressedTokens = compressed.reduce((sum, msg) => 
      sum + estimator.estimateMessageWithRole(msg), 0);
    
    return {
      messages: compressed,
      originalTokenCount: originalTokens,
      compressedTokenCount: compressedTokens,
      compressionRatio: compressedTokens / originalTokens,
      removedMessages: messages.length - compressed.length,
      strategyUsed: strategy
    };
  }
  
  private truncateHistory(
    messages: Message[],
    maxTokens: number,
    estimator: TokenEstimator
  ): Message[] {
    const result: Message[] = [];
    let currentTokens = 0;
    
    // Always try to keep first message if configured
    if (this.config.keepFirstLast && messages.length > 0) {
      const firstMsg = messages[0];
      const firstTokens = estimator.estimateMessageWithRole(firstMsg);
      
      if (firstTokens <= maxTokens) {
        result.push(firstMsg);
        currentTokens += firstTokens;
      }
    }
    
    // Add messages from the end (most recent) until we hit limit
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      
      // Skip if this is the first message and we already added it
      if (i === 0 && result.length > 0 && result[0] === msg) {
        continue;
      }
      
      const msgTokens = estimator.estimateMessageWithRole(msg);
      
      if (currentTokens + msgTokens <= maxTokens) {
        result.unshift(msg); // Add to beginning to maintain order
        currentTokens += msgTokens;
      } else {
        break;
      }
    }
    
    // Ensure we don't exceed max messages
    if (result.length > this.config.maxMessagesToKeep) {
      return result.slice(-this.config.maxMessagesToKeep);
    }
    
    return result;
  }
  
  private selectiveCompression(
    messages: Message[],
    maxTokens: number,
    estimator: TokenEstimator
  ): Message[] {
    // Score messages by importance
    const scored = messages.map((msg, index) => ({
      message: msg,
      score: this.calculateMessageScore(msg, index, messages.length),
      tokens: estimator.estimateMessageWithRole(msg)
    }));
    
    // Sort by score (highest first)
    scored.sort((a, b) => b.score - a.score);
    
    // Select highest-scoring messages that fit
    const result: Message[] = [];
    let currentTokens = 0;
    
    for (const item of scored) {
      if (currentTokens + item.tokens <= maxTokens) {
        result.push(item.message);
        currentTokens += item.tokens;
      }
    }
    
    // Restore original order
    result.sort((a, b) => {
      const indexA = messages.indexOf(a);
      const indexB = messages.indexOf(b);
      return indexA - indexB;
    });
    
    return result;
  }
  
  private hybridCompression(
    messages: Message[],
    maxTokens: number,
    estimator: TokenEstimator
  ): Message[] {
    // Keep first and last messages
    const importantIndices = new Set<number>();
    
    if (this.config.keepFirstLast) {
      if (messages.length > 0) importantIndices.add(0);
      if (messages.length > 1) importantIndices.add(messages.length - 1);
    }
    
    // Keep messages with tool calls
    messages.forEach((msg, index) => {
      if (msg.metadata?.hasToolCall) {
        importantIndices.add(index);
      }
    });
    
    // Build result with important messages first
    const result: Message[] = [];
    let currentTokens = 0;
    
    // Add important messages
    for (const index of Array.from(importantIndices).sort((a, b) => a - b)) {
      const msg = messages[index];
      const msgTokens = estimator.estimateMessageWithRole(msg);
      
      if (currentTokens + msgTokens <= maxTokens) {
        result.push(msg);
        currentTokens += msgTokens;
      }
    }
    
    // Fill remaining space with recent messages
    for (let i = messages.length - 1; i >= 0; i--) {
      if (importantIndices.has(i)) continue;
      
      const msg = messages[i];
      const msgTokens = estimator.estimateMessageWithRole(msg);
      
      if (currentTokens + msgTokens <= maxTokens) {
        // Insert in chronological order
        const insertIndex = result.findIndex(m => 
          messages.indexOf(m) > i
        );
        if (insertIndex === -1) {
          result.push(msg);
        } else {
          result.splice(insertIndex, 0, msg);
        }
        currentTokens += msgTokens;
      }
    }
    
    // Sort by original order
    result.sort((a, b) => {
      const indexA = messages.indexOf(a);
      const indexB = messages.indexOf(b);
      return indexA - indexB;
    });
    
    return result;
  }
  
  private calculateMessageScore(
    message: Message,
    index: number,
    totalMessages: number
  ): number {
    let score = 0;
    
    // Recency bonus (more recent = higher score)
    const recency = (index + 1) / totalMessages;
    score += recency * 40;
    
    // Length bonus (very short or very long might be important)
    const length = message.content.length;
    if (length > 500) score += 20; // Long messages often important
    if (length < 50) score += 10;  // Short commands are important
    
    // Role bonus
    if (message.role === 'user') score += 15;
    if (message.role === 'system') score += 30;
    
    // Tool call bonus
    if (message.metadata?.hasToolCall) score += 50;
    
    // First/last message bonus
    if (this.config.keepFirstLast) {
      if (index === 0) score += 60;
      if (index === totalMessages - 1) score += 60;
    }
    
    return score;
  }
  
  updateConfig(newConfig: Partial<ContextConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
  
  getConfig(): ContextConfig {
    return { ...this.config };
  }
}