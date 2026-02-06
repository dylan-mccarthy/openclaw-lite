import type { 
  AgentEvent,
  AgentStreamOptions
} from './types.js';
import type { Message } from '../context/types.js';
import { StreamingAgent } from './streaming-agent.js';
import { SteeringController, MessagePriority } from './steering.js';

/**
 * Steering-enabled streaming agent
 * 
 * Adds queued message processing and interruptions to StreamingAgent
 */
export class SteeringStreamingAgent extends StreamingAgent {
  private steeringController: SteeringController;
  private isInterrupted = false;
  private currentSessionId: string | null = null;
  
  constructor(agentLoop: any, toolBridge: any) {
    super(agentLoop, toolBridge);
    this.steeringController = new SteeringController();
    
    // Listen for urgent messages
    this.steeringController.addListener((queuedMessage) => {
      if (queuedMessage.priority === MessagePriority.URGENT && this.currentSessionId) {
        console.log(`[SteeringStreamingAgent] Urgent message received, interrupting session ${this.currentSessionId}`);
        this.isInterrupted = true;
      }
    });
  }
  
  /**
   * Run with steering support
   */
  async runWithSteering(
    prompt: string,
    systemPrompt: string = '',
    options?: AgentStreamOptions
  ): Promise<{
    response: string;
    events: AgentEvent[];
    queuedMessagesProcessed: number;
  }> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.currentSessionId = sessionId;
    this.isInterrupted = false;
    
    console.log(`[SteeringStreamingAgent] Starting session ${sessionId}`);
    
    const events: AgentEvent[] = [];
    let queuedMessagesProcessed = 0;
    
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
      // Check for queued messages before starting
      queuedMessagesProcessed += await this.processQueuedMessages(eventHandler);
      
      // If interrupted by urgent message, return early
      if (this.isInterrupted) {
        console.log(`[SteeringStreamingAgent] Session ${sessionId} interrupted before execution`);
        return {
          response: 'Execution interrupted by urgent message',
          events,
          queuedMessagesProcessed,
        };
      }
      
      // Run the agent (using parent class method)
      const result = await this.runWithStreaming(
        prompt,
        systemPrompt,
        {
          ...options,
          onEvent: (event) => {
            // Check for interruptions during execution
            if (this.isInterrupted && event.type === 'turn_end') {
              console.log(`[SteeringStreamingAgent] Interruption detected, stopping after current turn`);
              // We could throw an error here to stop execution
            }
            
            eventHandler(event);
            
            // Check for queued messages after each turn
            if (event.type === 'turn_end' && this.steeringController.hasPendingMessages()) {
              console.log(`[SteeringStreamingAgent] Processing queued messages between turns`);
              this.processQueuedMessages(eventHandler).then(count => {
                queuedMessagesProcessed += count;
              });
            }
          }
        }
      );
      
      return {
        response: result.response,
        events,
        queuedMessagesProcessed,
      };
      
    } catch (error) {
      eventHandler({
        type: 'error',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      this.currentSessionId = null;
      console.log(`[SteeringStreamingAgent] Completed session ${sessionId}`);
    }
  }
  
  /**
   * Process queued messages
   */
  private async processQueuedMessages(onEvent?: (event: AgentEvent) => void): Promise<number> {
    let processed = 0;
    
    while (this.steeringController.hasPendingMessages()) {
      const queuedMessage = this.steeringController.getNextMessage();
      if (!queuedMessage) break;
      
      console.log(`[SteeringStreamingAgent] Processing queued message: ${queuedMessage.id}`);
      
      // Emit events for queued message
      onEvent?.({
        type: 'message_start',
        message: queuedMessage.message,
      });
      
      // Mark as processed
      this.steeringController.markProcessed(queuedMessage.id);
      processed++;
      
      onEvent?.({
        type: 'message_end',
        message: queuedMessage.message,
      });
      
      // If urgent, set interruption flag
      if (queuedMessage.priority === MessagePriority.URGENT) {
        this.isInterrupted = true;
        console.log(`[SteeringStreamingAgent] Urgent message processed, setting interruption flag`);
      }
    }
    
    return processed;
  }
  
  /**
   * Queue a message for processing
   */
  queueMessage(
    message: Message,
    priority: MessagePriority = MessagePriority.NORMAL,
    metadata?: Record<string, any>
  ): string {
    return this.steeringController.queueMessage(message, priority, metadata);
  }
  
  /**
   * Interrupt current session
   */
  interrupt(): boolean {
    this.isInterrupted = true;
    return this.steeringController.interrupt();
  }
  
  /**
   * Get steering controller
   */
  getSteeringController(): SteeringController {
    return this.steeringController;
  }
  
  /**
   * Get steering statistics
   */
  getSteeringStats() {
    return this.steeringController.getStats();
  }
  
  /**
   * Check if currently interrupted
   */
  isCurrentlyInterrupted(): boolean {
    return this.isInterrupted;
  }
  
  /**
   * Clear interruption
   */
  clearInterruption(): void {
    this.isInterrupted = false;
  }
}