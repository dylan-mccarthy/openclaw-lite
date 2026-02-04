import type { 
  AgentEvent, 
  AgentStreamOptions,
  ToolDefinition
} from './types.js';
import type { Message } from '../context/types.js';
import { AgentLoop } from './agent-loop.js';
import type { ToolBridge } from './tool-bridge.js';

/**
 * Streaming agent that emits events in real-time
 * Uses Server-Sent Events (SSE) for web streaming
 */
export class StreamingAgent {
  constructor(
    private agentLoop: AgentLoop,
    private toolBridge: ToolBridge
  ) {}
  
  /**
   * Run agent with streaming events
   * Returns an async generator of events
   */
  async *runStreaming(
    prompt: string,
    systemPrompt: string = '',
    tools?: ToolDefinition[],
    options?: AgentStreamOptions
  ): AsyncGenerator<AgentEvent> {
    console.log(`[StreamingAgent] Starting streaming execution for: "${prompt.substring(0, 100)}..."`);
    
    // Create event handler that yields events
    const eventHandler = (event: AgentEvent) => {
      // This will be called by AgentLoop
      // We'll handle it via the stream callback
    };
    
    // We need to modify AgentLoop to support streaming callbacks
    // For now, use a simple wrapper
    
    try {
      // Yield start event
      yield { type: 'agent_start' };
      yield { type: 'turn_start' };
      
      // For Phase 2, we'll implement proper streaming
      // For now, run synchronously and yield events
      const result = await this.agentLoop.run(
        prompt,
        systemPrompt,
        tools,
        {
          ...options,
          onEvent: (event) => {
            // This would be called in real-time
            // We'll implement this properly in the next step
          }
        }
      );
      
      // Yield completion event
      yield { 
        type: 'agent_end',
        message: result.messages[result.messages.length - 1]
      };
      
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      };
      throw error;
    }
  }
  
  /**
   * Convert agent events to SSE format
   */
  static eventToSSE(event: AgentEvent): string {
    const data = JSON.stringify(event);
    return `data: ${data}\n\n`;
  }
  
  /**
   * Create SSE headers for HTTP response
   */
  static createSSEHeaders(): Record<string, string> {
    return {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    };
  }
  
  /**
   * Simple streaming run (for testing)
   */
  async runWithStreaming(
    prompt: string,
    systemPrompt: string = '',
    onEvent?: (event: AgentEvent) => void
  ): Promise<{
    response: string;
    events: AgentEvent[];
  }> {
    const events: AgentEvent[] = [];
    
    const eventHandler = (event: AgentEvent) => {
      events.push(event);
      onEvent?.(event);
    };
    
    // Start with agent events
    eventHandler({ type: 'agent_start' });
    eventHandler({ type: 'turn_start' });
    
    try {
      const result = await this.agentLoop.run(
        prompt,
        systemPrompt,
        undefined, // Get tools from ToolBridge
        { onEvent: eventHandler }
      );
      
      eventHandler({ 
        type: 'agent_end',
        message: result.messages[result.messages.length - 1]
      });
      
      return {
        response: result.response,
        events,
      };
      
    } catch (error) {
      eventHandler({
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  
  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    return this.agentLoop.healthCheck();
  }
}