import type { 
  AgentEvent,
  AgentStreamOptions
} from './types.js';
import type { Message } from '../context/types.js';
import { SteeringStreamingAgent } from './steering-streaming-agent.js';
import { MemoryIntegration } from './memory-integration.js';

/**
 * Memory-enhanced streaming agent
 * 
 * Adds memory search and storage to SteeringStreamingAgent
 */
export class MemoryStreamingAgent extends SteeringStreamingAgent {
  private memoryIntegration: MemoryIntegration;
  private memoryEnabled: boolean;
  
  constructor(agentLoop: any, toolBridge: any, memoryIntegration: MemoryIntegration) {
    super(agentLoop, toolBridge);
    this.memoryIntegration = memoryIntegration;
    this.memoryEnabled = true;
  }
  
  /**
   * Run with memory enhancement
   */
  async runWithMemory(
    prompt: string,
    systemPrompt: string = '',
    options?: AgentStreamOptions
  ): Promise<{
    response: string;
    events: AgentEvent[];
    queuedMessagesProcessed: number;
    memoryUsed: boolean;
    memorySessionsFound: number;
  }> {
    const sessionId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    console.log(`[MemoryStreamingAgent] Starting memory-enhanced session ${sessionId}`);
    
    const events: AgentEvent[] = [];
    let queuedMessagesProcessed = 0;
    let memoryUsed = false;
    let memorySessionsFound = 0;
    
    const eventHandler = (event: AgentEvent) => {
      const stampedEvent = {
        ...event,
        timestamp: event.timestamp || new Date().toISOString(),
        runId: event.runId || options?.runId,
        sessionId: event.sessionId || options?.sessionId,
      };
      events.push(stampedEvent);
      options?.onEvent?.(stampedEvent);
    };
    
    try {
      // Search memory if enabled
      let memoryContext = '';
      if (this.memoryEnabled) {
        const memoryResult = await this.memoryIntegration.searchMemory(prompt);
        memoryContext = memoryResult.context;
        memorySessionsFound = memoryResult.sessions.length;
        memoryUsed = memoryContext.length > 0;
        
        if (memoryUsed) {
          console.log(`[MemoryStreamingAgent] Found ${memorySessionsFound} relevant memory sessions`);
          
          eventHandler({
            type: 'memory_search',
            query: prompt,
            sessionsFound: memorySessionsFound,
            contextLength: memoryContext.length,
          });
        }
      }
      
      // Enhance system prompt with memory
      const enhancedSystemPrompt = memoryContext
        ? `${systemPrompt}\n\n${memoryContext}`
        : systemPrompt;
      
      // Run with steering (parent class)
      const result = await this.runWithSteering(
        prompt,
        enhancedSystemPrompt,
        {
          ...options,
          onEvent: (event) => {
            eventHandler(event);
          }
        }
      );
      
      queuedMessagesProcessed = result.queuedMessagesProcessed;
      
      // Save conversation to memory (ALL conversations now)
      if (this.memoryEnabled && result.response && result.response.length > 0) {
        try {
          // Create conversation messages from the interaction
          // Note: In a full implementation, we would capture the actual message exchange
          // For now, create a simplified version
          const conversationMessages: Message[] = [
            {
              role: 'user',
              content: prompt,
              timestamp: new Date(),
            },
            {
              role: 'assistant',
              content: result.response,
              timestamp: new Date(),
            },
          ];
          
          // Add any tool messages from events
          const toolEvents = events.filter(e => e.type === 'tool_result' || e.type === 'tool_error');
          for (const toolEvent of toolEvents) {
            if (toolEvent.type === 'tool_result') {
              conversationMessages.push({
                role: 'assistant', // Tool results come from assistant using tools
                content: typeof toolEvent.result === 'string' 
                  ? toolEvent.result 
                  : JSON.stringify(toolEvent.result),
                timestamp: new Date(),
                metadata: {
                  tool: toolEvent.toolName,
                  duration: toolEvent.duration,
                  success: true,
                },
              });
            } else if (toolEvent.type === 'tool_error') {
              conversationMessages.push({
                role: 'assistant',
                content: `Tool error: ${toolEvent.error}`,
                timestamp: new Date(),
                metadata: {
                  tool: toolEvent.toolName,
                  duration: toolEvent.duration,
                  success: false,
                  error: toolEvent.error,
                },
              });
            }
          }
          
          // Save to memory
          this.saveConversation(
            sessionId,
            conversationMessages,
            {
              name: `Conversation: ${prompt.substring(0, 50)}...`,
              tags: this.extractTagsFromPrompt(prompt),
              additional: {
                toolCount: toolEvents.length,
                streamingSession: true,
                queuedMessagesProcessed: result.queuedMessagesProcessed,
                memoryUsed,
                memorySessionsFound,
              },
            }
          );
          
          console.log(`[MemoryStreamingAgent] Saved conversation ${sessionId} to memory with ${conversationMessages.length} messages`);
          
          eventHandler({
            type: 'memory_save',
            sessionId,
            saved: true,
            messageCount: conversationMessages.length,
            toolCount: toolEvents.length,
          });
          
        } catch (error) {
          console.warn(`[MemoryStreamingAgent] Error saving conversation to memory:`, error);
          eventHandler({
            type: 'memory_save',
            sessionId,
            saved: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      
      return {
        response: result.response,
        events,
        queuedMessagesProcessed,
        memoryUsed,
        memorySessionsFound,
      };
      
    } catch (error) {
      eventHandler({
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      console.log(`[MemoryStreamingAgent] Completed memory-enhanced session ${sessionId}`);
    }
  }
  
  /**
   * Enable/disable memory
   */
  setMemoryEnabled(enabled: boolean): void {
    this.memoryEnabled = enabled;
    console.log(`[MemoryStreamingAgent] Memory ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Get memory statistics
   */
  getMemoryStats() {
    return this.memoryIntegration.getStats();
  }
  
  /**
   * Search memory directly
   */
  async searchMemory(
    query: string,
    options?: {
      limit?: number;
      minRelevance?: number;
    }
  ) {
    return this.memoryIntegration.searchMemory(query, options);
  }
  
  /**
   * Save conversation to memory
   */
  saveConversation(
    sessionId: string,
    messages: Message[],
    metadata?: {
      name?: string;
      tags?: string[];
      additional?: Record<string, any>;
    }
  ): void {
    this.memoryIntegration.saveConversation(sessionId, messages, metadata);
  }
  
  /**
   * Extract tags from prompt
   */
  private extractTagsFromPrompt(prompt: string): string[] {
    const tags = new Set<string>();
    
    // Add default tags
    tags.add('conversation');
    tags.add('streaming');
    
    const promptLower = prompt.toLowerCase();
    
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
      { keyword: 'show', tag: 'show' },
      { keyword: 'create', tag: 'create' },
      { keyword: 'delete', tag: 'delete' },
      { keyword: 'move', tag: 'move' },
      { keyword: 'copy', tag: 'copy' },
    ];
    
    for (const { keyword, tag } of topicKeywords) {
      if (promptLower.includes(keyword)) {
        tags.add(tag);
      }
    }
    
    // Check for question words
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'can', 'could', 'would', 'should'];
    for (const word of questionWords) {
      if (promptLower.startsWith(word) || promptLower.includes(` ${word} `)) {
        tags.add('question');
        break;
      }
    }
    
    return Array.from(tags);
  }
  
  /**
   * Clear memory
   */
  clearMemory(): void {
    this.memoryIntegration.clearMemory();
    console.log(`[MemoryStreamingAgent] Memory cleared`);
  }
}