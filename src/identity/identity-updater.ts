/**
 * Unified Identity Updater for OpenClaw Lite
 * Handles both SOUL.md (personality) and USER.md (user memory) updates
 * Uses agent reasoning for both
 */

import { PersonalityUpdater } from './personality-updater.js';
import { UserMemoryAgent } from './user-memory-agent.js';
import type { OllamaIntegration } from '../ollama/integration.js';

export class IdentityUpdater {
  private personalityUpdater: PersonalityUpdater;
  private userMemoryAgent: UserMemoryAgent;
  private analysisInterval: number = 10;
  private conversationCount: number = 0;
  
  constructor(
    workspaceDir: string,
    ollamaIntegration: OllamaIntegration
  ) {
    this.personalityUpdater = new PersonalityUpdater(workspaceDir);
    this.userMemoryAgent = new UserMemoryAgent(workspaceDir, ollamaIntegration);
  }
  
  /**
   * Log a conversation for analysis
   */
  logConversation(userMessage: string, assistantMessage: string): void {
    this.personalityUpdater.logConversation(userMessage, assistantMessage);
    this.conversationCount++;
    
    // Analyze periodically (both personality and user memory)
    if (this.conversationCount % this.analysisInterval === 0) {
      this.analyzeAndUpdate();
    }
  }
  
  /**
   * Analyze conversations and update both SOUL.md and USER.md
   */
  async analyzeAndUpdate(): Promise<{
    personalityUpdated: boolean;
    userMemoryUpdated: boolean;
    summary: string;
  }> {
    console.log('🧠 Analyzing conversations for identity updates...');
    
    const results = {
      personalityUpdated: false,
      userMemoryUpdated: false,
      summary: ''
    };
    
    try {
      // Update personality (SOUL.md) - synchronous
      this.personalityUpdater.analyzeAndUpdate();
      results.personalityUpdated = true;
      
      // Update user memory (USER.md) - asynchronous with agent
      const userUpdated = await this.userMemoryAgent.analyzeAndUpdate();
      results.userMemoryUpdated = userUpdated;
      
      // Create summary
      const updates = [];
      if (results.personalityUpdated) updates.push('personality (SOUL.md)');
      if (results.userMemoryUpdated) updates.push('user memory (USER.md)');
      
      if (updates.length > 0) {
        results.summary = `Updated ${updates.join(' and ')} based on recent conversations`;
      } else {
        results.summary = 'No significant updates needed';
      }
      
      console.log(`✅ Identity analysis complete: ${results.summary}`);
      
    } catch (error) {
      console.warn('Identity analysis failed:', error);
      results.summary = `Analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    
    return results;
  }
  
  /**
   * Get current personality traits
   */
  getCurrentPersonality(): string[] {
    return this.personalityUpdater.getCurrentPersonality();
  }
  
  /**
   * Get current user info summary
   */
  getCurrentUserSummary(): string {
    return this.userMemoryAgent.getCurrentUserSummary();
  }
  
  /**
   * Manually trigger analysis
   */
  async manualUpdate(): Promise<{
    personalityUpdated: boolean;
    userMemoryUpdated: boolean;
    summary: string;
  }> {
    console.log('🧠👤 Manually triggering identity analysis...');
    return await this.analyzeAndUpdate();
  }
  
  /**
   * Clear conversation log
   */
  clearConversationLog(): void {
    this.personalityUpdater.clearConversationLog();
    this.conversationCount = 0;
  }
}