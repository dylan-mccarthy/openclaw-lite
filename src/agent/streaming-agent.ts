import type { 
  AgentEvent, 
  AgentStreamOptions,
  ToolDefinition
} from './types.js';
import type { Message } from '../context/types.js';
import { AgentLoop } from './agent-loop.js';
import type { ToolBridge } from './tool-bridge.js';
import { EventStream } from './event-stream.js';

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

    const stream = EventStream.createAgentStream();
    let runError: unknown;

    const runPromise = this.agentLoop.run(
      prompt,
      systemPrompt,
      tools,
      {
        ...options,
        onEvent: (event) => {
          const stampedEvent = {
            ...event,
            timestamp: event.timestamp || new Date().toISOString(),
          };
          stream.push(stampedEvent);
          options?.onEvent?.(stampedEvent);
        }
      }
    ).catch((error) => {
      runError = error;
    });

    for await (const event of stream) {
      yield event;
    }

    await runPromise;

    if (runError) {
      throw runError;
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
    options?: AgentStreamOptions
  ): Promise<{
    response: string;
    events: AgentEvent[];
  }> {
    const events: AgentEvent[] = [];
    
    const eventHandler = (event: AgentEvent) => {
      events.push(event);
      options?.onEvent?.(event);
    };
    
    try {
      const result = await this.agentLoop.run(
        prompt,
        systemPrompt,
        undefined, // Get tools from ToolBridge
        {
          ...options,
          onEvent: eventHandler,
        }
      );
      
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