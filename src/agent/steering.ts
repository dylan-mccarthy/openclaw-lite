import type { Message } from '../context/types.js';

/**
 * Priority levels for queued messages
 */
export enum MessagePriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

/**
 * Queued message with priority
 */
export interface QueuedMessage {
  id: string;
  message: Message;
  priority: MessagePriority;
  timestamp: Date;
  processed: boolean;
  metadata?: Record<string, any>;
}

/**
 * Steering controller for agent interruptions
 * 
 * Inspired by OpenClaw's steerable-agent-loop
 */
export class SteeringController {
  private messageQueue: QueuedMessage[] = [];
  private currentTurnId: string | null = null;
  private isProcessing = false;
  private listeners: Array<(message: QueuedMessage) => void> = [];
  
  /**
   * Queue a message for the agent
   */
  queueMessage(
    message: Message,
    priority: MessagePriority = MessagePriority.NORMAL,
    metadata?: Record<string, any>
  ): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const queuedMessage: QueuedMessage = {
      id,
      message,
      priority,
      timestamp: new Date(),
      processed: false,
      metadata,
    };
    
    this.messageQueue.push(queuedMessage);
    
    // Sort by priority (urgent first)
    this.messageQueue.sort((a, b) => {
      const priorityOrder = {
        [MessagePriority.URGENT]: 0,
        [MessagePriority.HIGH]: 1,
        [MessagePriority.NORMAL]: 2,
        [MessagePriority.LOW]: 3,
      };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    console.log(`[Steering] Queued message ${id} with priority ${priority}`);
    
    // Notify listeners
    this.listeners.forEach(listener => listener(queuedMessage));
    
    return id;
  }
  
  /**
   * Get next message from queue
   */
  getNextMessage(): QueuedMessage | null {
    if (this.messageQueue.length === 0) {
      return null;
    }
    
    // Get highest priority message
    const message = this.messageQueue[0];
    
    // Mark as being processed
    this.isProcessing = true;
    
    return message;
  }
  
  /**
   * Mark message as processed
   */
  markProcessed(messageId: string): void {
    const index = this.messageQueue.findIndex(msg => msg.id === messageId);
    if (index !== -1) {
      this.messageQueue[index].processed = true;
      // Remove processed messages after a delay
      setTimeout(() => {
        this.messageQueue = this.messageQueue.filter(msg => msg.id !== messageId);
      }, 1000);
    }
    this.isProcessing = false;
  }
  
  /**
   * Check if there are pending messages
   */
  hasPendingMessages(): boolean {
    return this.messageQueue.length > 0 && !this.isProcessing;
  }
  
  /**
   * Get all pending messages
   */
  getPendingMessages(): QueuedMessage[] {
    return this.messageQueue.filter(msg => !msg.processed);
  }
  
  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.messageQueue = [];
    this.isProcessing = false;
  }
  
  /**
   * Set current turn ID (for tracking)
   */
  setCurrentTurnId(turnId: string | null): void {
    this.currentTurnId = turnId;
  }
  
  /**
   * Get current turn ID
   */
  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }
  
  /**
   * Add listener for new messages
   */
  addListener(listener: (message: QueuedMessage) => void): void {
    this.listeners.push(listener);
  }
  
  /**
   * Remove listener
   */
  removeListener(listener: (message: QueuedMessage) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }
  
  /**
   * Interrupt current execution (for urgent messages)
   */
  interrupt(): boolean {
    if (!this.currentTurnId) {
      return false; // No current turn to interrupt
    }
    
    console.log(`[Steering] Interrupting turn ${this.currentTurnId}`);
    
    // In a real implementation, this would signal the agent loop
    // For now, just log and return success
    return true;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      totalQueued: this.messageQueue.length,
      pending: this.getPendingMessages().length,
      processed: this.messageQueue.filter(msg => msg.processed).length,
      byPriority: {
        [MessagePriority.URGENT]: this.messageQueue.filter(msg => msg.priority === MessagePriority.URGENT).length,
        [MessagePriority.HIGH]: this.messageQueue.filter(msg => msg.priority === MessagePriority.HIGH).length,
        [MessagePriority.NORMAL]: this.messageQueue.filter(msg => msg.priority === MessagePriority.NORMAL).length,
        [MessagePriority.LOW]: this.messageQueue.filter(msg => msg.priority === MessagePriority.LOW).length,
      },
    };
  }
}