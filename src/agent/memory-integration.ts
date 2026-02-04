import type { Message } from '../context/types.js';
import type { MemoryManager } from '../memory/memory-manager.js';

/**
 * Memory integration for agents
 * 
 * Provides memory search and storage capabilities
 * Can be used with any agent implementation
 */
export class MemoryIntegration {
  private memoryManager: MemoryManager;
  private enabled: boolean;
  private searchLimit: number;
  
  constructor(
    memoryManager: MemoryManager,
    options: {
      enabled?: boolean;
      searchLimit?: number;
    } = {}
  ) {
    this.memoryManager = memoryManager;
    this.enabled = options.enabled ?? true;
    this.searchLimit = options.searchLimit ?? 5;
  }
  
  /**
   * Search memory for relevant context
   */
  async searchMemory(
    query: string,
    options: {
      limit?: number;
      minRelevance?: number;
    } = {}
  ): Promise<{
    context: string;
    sessions: Array<{
      sessionId: string;
      relevance: number;
      summary: string;
    }>;
  }> {
    if (!this.enabled) {
      return { context: '', sessions: [] };
    }
    
    console.log(`[MemoryIntegration] Searching memory for: "${query.substring(0, 100)}..."`);
    
    const limit = options.limit || this.searchLimit;
    const minRelevance = options.minRelevance || 1;
    
    try {
      // Get recent sessions
      const sessions = this.memoryManager.listSessions();
      const recentSessions = sessions
        .sort((a, b) => b.lastAccessed - a.lastAccessed)
        .slice(0, limit * 2); // Get more than limit for filtering
      
      const relevantSessions: Array<{
        sessionId: string;
        relevance: number;
        summary: string;
      }> = [];
      
      for (const session of recentSessions) {
        try {
          const sessionData = this.memoryManager.loadSession(session.sessionId);
          if (sessionData && sessionData.messages.length > 0) {
            const relevance = this.calculateRelevance(query, sessionData);
            
            if (relevance >= minRelevance) {
              const summary = this.summarizeSession(sessionData);
              relevantSessions.push({
                sessionId: session.sessionId,
                relevance,
                summary,
              });
              
              console.log(`[MemoryIntegration] Relevant session: ${session.sessionId} (relevance: ${relevance})`);
            }
          }
        } catch (error) {
          console.warn(`[MemoryIntegration] Error loading session ${session.sessionId}:`, error);
        }
      }
      
      // Sort by relevance and take top N
      relevantSessions.sort((a, b) => b.relevance - a.relevance);
      const topSessions = relevantSessions.slice(0, limit);
      
      // Build context
      let context = '';
      if (topSessions.length > 0) {
        context = '## Relevant Previous Conversations:\n';
        for (const session of topSessions) {
          context += `\n--- Session (relevance: ${session.relevance}/10) ---\n`;
          context += `${session.summary}\n`;
        }
        context += '\n## Current Task:\n';
      }
      
      return {
        context,
        sessions: topSessions,
      };
      
    } catch (error) {
      console.error(`[MemoryIntegration] Memory search error:`, error);
      return { context: '', sessions: [] };
    }
  }
  
  /**
   * Calculate relevance score for a session
   */
  private calculateRelevance(query: string, sessionData: any): number {
    const messages = sessionData.messages || [];
    if (messages.length === 0) {
      return 0;
    }
    
    // Combine all messages into text
    const sessionText = messages
      .map((m: Message) => m.content)
      .join(' ')
      .toLowerCase();
    
    const queryLower = query.toLowerCase();
    
    // Simple keyword matching for Phase 3
    // In production, use embeddings or vector search
    
    // Extract meaningful keywords
    const keywords = queryLower
      .split(/\s+/)
      .filter(w => w.length > 3)
      .filter(w => !this.isCommonWord(w));
    
    if (keywords.length === 0) {
      // If no meaningful keywords, check for partial matches
      const words = queryLower.split(/\s+/).filter(w => w.length > 2);
      let score = 0;
      
      for (const word of words) {
        if (sessionText.includes(word)) {
          score += 1;
        }
      }
      
      return Math.min(score, 5); // Cap at 5
    }
    
    // Calculate relevance based on keyword matches
    let relevance = 0;
    
    for (const keyword of keywords) {
      if (sessionText.includes(keyword)) {
        relevance += 2; // Exact keyword match
      } else if (this.hasPartialMatch(keyword, sessionText)) {
        relevance += 1; // Partial match
      }
    }
    
    // Normalize to 0-10 scale
    const maxPossible = keywords.length * 2;
    const normalized = maxPossible > 0 ? (relevance / maxPossible) * 10 : 0;
    
    return Math.round(normalized * 10) / 10; // Round to 1 decimal
  }
  
  /**
   * Check for partial word matches
   */
  private hasPartialMatch(keyword: string, text: string): boolean {
    // Check for word stems or partial matches
    if (keyword.length <= 3) return false;
    
    // Try different stem lengths
    for (let i = 4; i <= keyword.length; i++) {
      const stem = keyword.substring(0, i);
      if (text.includes(stem)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if word is common
   */
  private isCommonWord(word: string): boolean {
    const commonWords = [
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
      'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him',
      'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who',
      'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'that',
      'with', 'this', 'from', 'have', 'they', 'what', 'when', 'where', 'which',
      'will', 'your', 'about', 'could', 'would', 'should', 'there', 'their'
    ];
    
    return commonWords.includes(word.toLowerCase());
  }
  
  /**
   * Summarize a session
   */
  private summarizeSession(sessionData: any): string {
    const messages = sessionData.messages || [];
    const metadata = sessionData.metadata || {};
    
    if (messages.length === 0) {
      return 'Empty session';
    }
    
    // Get key messages (handle tool role which might not be in Message type)
    const userMessages = messages.filter((m: any) => m.role === 'user');
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    const toolMessages = messages.filter((m: any) => m.role === 'tool' || m.metadata?.tool);
    
    let summary = '';
    
    // Add first user message
    if (userMessages.length > 0) {
      const firstUser = userMessages[0];
      summary += `User asked: "${firstUser.content.substring(0, 150)}..."\n`;
    }
    
    // Add last assistant response
    if (assistantMessages.length > 0) {
      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      summary += `Assistant responded: "${lastAssistant.content.substring(0, 150)}..."\n`;
    }
    
    // Add tool usage info
    if (toolMessages.length > 0) {
      summary += `Used ${toolMessages.length} tool(s)\n`;
    }
    
    // Add tags if available
    const tags = metadata.tags || [];
    if (tags.length > 0) {
      summary += `Tags: ${tags.join(', ')}\n`;
    }
    
    // Add message count
    summary += `Total messages: ${messages.length}`;
    
    return summary;
  }
  
  /**
   * Save conversation to memory
   * 
   * Updated: Saves ALL conversations (not just "significant" ones)
   * Logs tool usage with parameters
   */
  saveConversation(
    sessionId: string,
    messages: Message[],
    metadata: {
      name?: string;
      tags?: string[];
      additional?: Record<string, any>;
    } = {}
  ): void {
    if (!this.enabled || messages.length < 2) {
      return;
    }
    
    try {
      console.log(`[MemoryIntegration] Saving conversation to memory: ${sessionId}`);
      
      // Auto-extract tags if not provided
      const tags = metadata.tags || this.extractTagsFromMessages(messages);
      
      // Extract tool usage information
      const toolUsage = this.extractToolUsage(messages);
      
      // Save to memory
      this.memoryManager.saveSession(
        sessionId,
        messages,
        {
          name: metadata.name || `Conversation: ${this.getFirstUserMessage(messages)}`,
          tags,
          metadata: {
            ...metadata.additional,
            savedBy: 'MemoryIntegration',
            timestamp: Date.now(),
            toolUsage, // Add tool usage metadata
            messageCount: messages.length,
            hasTools: toolUsage.length > 0,
          },
        }
      );
      
      console.log(`[MemoryIntegration] Saved ${messages.length} messages, ${toolUsage.length} tool executions`);
      
    } catch (error) {
      console.warn(`[MemoryIntegration] Error saving conversation:`, error);
    }
  }
  
  /**
   * Extract tool usage information from messages
   */
  private extractToolUsage(messages: Message[]): Array<{
    tool: string;
    timestamp: Date;
    parameters?: any;
    result?: any;
    success?: boolean;
  }> {
    const toolUsage: Array<{
      tool: string;
      timestamp: Date;
      parameters?: any;
      result?: any;
      success?: boolean;
    }> = [];
    
    for (const message of messages) {
      // Check for tool role (might be stored as 'tool' or in metadata)
      const role = (message as any).role;
      const isToolMessage = role === 'tool' || message.metadata?.tool;
      
      if (isToolMessage) {
        const toolName = message.metadata?.tool || 'unknown';
        const timestamp = message.timestamp || new Date();
        
        // Try to extract parameters and result from content
        let parameters: any = undefined;
        let result: any = undefined;
        let success: boolean = true;
        
        try {
          // Content might be JSON or a string
          if (message.content) {
            if (message.content.startsWith('{') || message.content.startsWith('[')) {
              const parsed = JSON.parse(message.content);
              if (typeof parsed === 'object') {
                // Check if it's a result or parameters
                if (parsed.result !== undefined) {
                  result = parsed.result;
                } else if (parsed.error !== undefined) {
                  result = { error: parsed.error };
                  success = false;
                } else {
                  // Might be parameters
                  parameters = parsed;
                }
              }
            } else {
              // Plain text result
              result = message.content;
            }
          }
        } catch (error) {
          // Not JSON, use as-is
          result = message.content;
        }
        
        // Extract parameters from metadata if available
        if (!parameters && message.metadata?.args) {
          parameters = message.metadata.args;
        }
        if (!parameters && message.metadata?.arguments) {
          parameters = message.metadata.arguments;
        }
        
        toolUsage.push({
          tool: toolName,
          timestamp,
          parameters,
          result,
          success,
        });
      }
    }
    
    return toolUsage;
  }
  
  /**
   * Extract tags from messages
   */
  private extractTagsFromMessages(messages: Message[]): string[] {
    const tags = new Set<string>();
    
    // Add default tags
    tags.add('agent-conversation');
    
    // Check for tool usage (tool role might be stored in metadata)
    const hasTools = messages.some(m => {
      const role = (m as any).role;
      return role === 'tool' || m.metadata?.tool;
    });
    if (hasTools) {
      tags.add('tool-assisted');
    }
    
    // Extract keywords from first user message
    const firstUserMessage = messages.find(m => m.role === 'user');
    if (firstUserMessage) {
      const text = firstUserMessage.content.toLowerCase();
      
      // Check for common topics
      const topicKeywords = [
        { keyword: 'file', tag: 'files' },
        { keyword: 'list', tag: 'listing' },
        { keyword: 'read', tag: 'reading' },
        { keyword: 'write', tag: 'writing' },
        { keyword: 'git', tag: 'git' },
        { keyword: 'search', tag: 'search' },
        { keyword: 'http', tag: 'web' },
        { keyword: 'process', tag: 'system' },
        { keyword: 'workspace', tag: 'workspace' },
        { keyword: 'project', tag: 'project' },
        { keyword: 'code', tag: 'code' },
        { keyword: 'help', tag: 'help' },
        { keyword: 'explain', tag: 'explanation' },
      ];
      
      for (const { keyword, tag } of topicKeywords) {
        if (text.includes(keyword)) {
          tags.add(tag);
        }
      }
    }
    
    return Array.from(tags);
  }
  
  /**
   * Get first user message
   */
  private getFirstUserMessage(messages: Message[]): string {
    const firstUser = messages.find(m => m.role === 'user');
    return firstUser 
      ? firstUser.content.substring(0, 50) + (firstUser.content.length > 50 ? '...' : '')
      : 'Unknown';
  }
  
  /**
   * Enable/disable memory
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[MemoryIntegration] Memory ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Set search limit
   */
  setSearchLimit(limit: number): void {
    this.searchLimit = Math.max(1, Math.min(limit, 20));
    console.log(`[MemoryIntegration] Search limit set to ${this.searchLimit}`);
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    enabled: boolean;
    searchLimit: number;
    sessionCount: number;
  } {
    const sessions = this.memoryManager.listSessions();
    
    return {
      enabled: this.enabled,
      searchLimit: this.searchLimit,
      sessionCount: sessions.length,
    };
  }
  
  /**
   * Clear all memory
   */
  clearMemory(): void {
    const sessions = this.memoryManager.listSessions();
    
    for (const session of sessions) {
      try {
        this.memoryManager.deleteSession(session.sessionId);
      } catch (error) {
        console.warn(`[MemoryIntegration] Error deleting session ${session.sessionId}:`, error);
      }
    }
    
    console.log(`[MemoryIntegration] Cleared ${sessions.length} sessions from memory`);
  }
}