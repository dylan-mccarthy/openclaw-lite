import type { AgentEvent } from './types.js';

/**
 * Simplified EventStream similar to OpenClaw's implementation
 * Handles async event streaming for agent execution
 */
export class EventStream {
  private queue: AgentEvent[] = [];
  private waiting: Array<(value: IteratorResult<AgentEvent>) => void> = [];
  private done = false;
  private finalResultPromise: Promise<AgentEvent[]>;
  private resolveFinalResult!: (value: AgentEvent[]) => void;
  
  constructor(
    private isComplete: (event: AgentEvent) => boolean,
    private extractResult: (event: AgentEvent) => AgentEvent[]
  ) {
    this.finalResultPromise = new Promise((resolve) => {
      this.resolveFinalResult = resolve;
    });
  }
  
  /**
   * Push an event to the stream
   */
  push(event: AgentEvent): void {
    if (this.done) return;
    
    if (this.isComplete(event)) {
      this.done = true;
      this.resolveFinalResult(this.extractResult(event));
    }
    
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }
  
  /**
   * End the stream with optional result
   */
  end(result?: AgentEvent[]): void {
    this.done = true;
    if (result !== undefined) {
      this.resolveFinalResult(result);
    }
    
    // Notify all waiting consumers
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift();
      if (waiter) {
        waiter({ value: undefined, done: true });
      }
    }
  }
  
  /**
   * Async iterator for consuming events
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
    while (true) {
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next !== undefined) {
          yield next;
        }
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<AgentEvent>>(
          (resolve) => this.waiting.push(resolve)
        );
        if (result.done) return;
        yield result.value;
      }
    }
  }
  
  /**
   * Get the final result promise
   */
  result(): Promise<AgentEvent[]> {
    return this.finalResultPromise;
  }
  
  /**
   * Check if stream is complete
   */
  isCompleteCheck(): boolean {
    return this.done;
  }
  
  /**
   * Create a simple agent event stream
   */
  static createAgentStream(): EventStream {
    return new EventStream(
      (event) => event.type === 'agent_end',
      (event) => event.type === 'agent_end' ? [] : []
    );
  }
  
  /**
   * Create a stream that collects all events
   */
  static createCollectingStream(): EventStream {
    const events: AgentEvent[] = [];
    return new EventStream(
      (event) => event.type === 'agent_end',
      () => events
    );
  }
}