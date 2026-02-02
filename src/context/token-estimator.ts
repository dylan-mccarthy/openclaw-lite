export class TokenEstimator {
  private averageCharsPerToken: number;
  
  constructor(averageCharsPerToken: number = 4) {
    this.averageCharsPerToken = averageCharsPerToken;
  }
  
  estimate(text: string): number {
    if (!text || text.length === 0) return 0;
    
    // Simple estimation: characters / average
    const charCount = text.length;
    
    // Adjust for whitespace (tokens often include whitespace)
    const whitespaceRatio = (text.match(/\s/g) || []).length / charCount;
    const adjustedChars = charCount * (1 - whitespaceRatio * 0.3);
    
    // Adjust for code/markdown (more tokens)
    const hasCode = text.includes('```') || text.includes('`');
    const hasMarkdown = text.match(/#+|\[|\]|\(|\)|\*+/g);
    const complexityFactor = hasCode ? 1.2 : hasMarkdown ? 1.1 : 1.0;
    
    return Math.ceil((adjustedChars / this.averageCharsPerToken) * complexityFactor);
  }
  
  estimateMessages(messages: Message[]): number {
    return messages.reduce((sum, msg) => 
      sum + (msg.tokens || this.estimate(msg.content)), 0);
  }
  
  estimateMessageWithRole(message: Message): number {
    // Add tokens for role prefix (e.g., "user: " or "assistant: ")
    const rolePrefix = `${message.role}: `;
    const contentTokens = message.tokens || this.estimate(message.content);
    const roleTokens = this.estimate(rolePrefix);
    
    return contentTokens + roleTokens;
  }
  
  static createForModel(modelId: string): TokenEstimator {
    // Different models have different tokenization characteristics
    const modelConfig: Record<string, number> = {
      'ollama/qwen3:latest': 3.8,
      'ollama/llama3.1:8b': 4.0,
      'ollama/qwen2.5-coder:7b': 3.5, // Code has more tokens
      'deepseek/deepseek-chat': 4.0,
      'openai/gpt-4': 4.0,
    };
    
    const charsPerToken = modelConfig[modelId] || 4.0;
    return new TokenEstimator(charsPerToken);
  }
}

// Re-export Message type for convenience
import type { Message } from './types.js';
export type { Message };