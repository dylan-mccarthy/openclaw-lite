/**
 * User Memory Agent for OpenClaw Lite
 * Agent-driven USER.md updates based on conversation analysis
 * Runs alongside personality updates, uses agent reasoning
 */

import fs from 'fs';
import path from 'path';
import { OllamaIntegration } from '../ollama/integration.js';
import type { Message } from '../context/types.js';

export interface UserMemoryAnalysis {
  importantFacts: string[];
  suggestedUpdates: {
    field: string;
    value: string;
    reason: string;
  }[];
  summary: string;
}

export class UserMemoryAgent {
  private userPath: string;
  private conversationLogPath: string;
  private ollamaIntegration: OllamaIntegration;
  private analysisInterval: number = 10; // Same as personality updates
  
  constructor(
    private workspaceDir: string,
    ollamaIntegration: OllamaIntegration
  ) {
    const identityDir = path.join(workspaceDir, 'identity');
    this.userPath = path.join(identityDir, 'USER.md');
    this.conversationLogPath = path.join(identityDir, 'conversations.log');
    this.ollamaIntegration = ollamaIntegration;
    
    // Ensure directories exist
    if (!fs.existsSync(identityDir)) {
      fs.mkdirSync(identityDir, { recursive: true });
    }
  }
  
  /**
   * Analyze conversations and update USER.md using agent reasoning
   */
  async analyzeAndUpdate(): Promise<boolean> {
    try {
      if (!fs.existsSync(this.conversationLogPath)) {
        console.log('📝 No conversation log for user memory analysis');
        return false;
      }
      
      // Read recent conversations
      const logContent = fs.readFileSync(this.conversationLogPath, 'utf-8');
      const entries = logContent
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(entry => entry !== null)
        .slice(-this.analysisInterval * 2); // Last 2x interval for context
      
      if (entries.length < 5) {
        console.log('📝 Not enough conversations for user memory analysis');
        return false;
      }
      
      // Prepare conversation context for agent
      const conversationContext = this.prepareConversationContext(entries);
      
      // Get current USER.md content
      const currentUserContent = fs.existsSync(this.userPath) 
        ? fs.readFileSync(this.userPath, 'utf-8')
        : this.createDefaultUserTemplate();
      
      // Ask agent to analyze and suggest updates
      const analysis = await this.askAgentToAnalyze(conversationContext, currentUserContent);
      
      if (analysis.suggestedUpdates.length === 0) {
        console.log('🤔 Agent found no important user updates needed');
        return false;
      }
      
      // Apply updates
      const updated = this.applyAgentSuggestions(currentUserContent, analysis);
      
      if (updated) {
        console.log('👤 Updated USER.md based on agent analysis');
        console.log(`   Summary: ${analysis.summary}`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      console.warn('Failed in user memory analysis:', error);
      return false;
    }
  }
  
  /**
   * Prepare conversation context for agent
   */
  private prepareConversationContext(entries: any[]): string {
    const recentConversations = entries.slice(-10); // Last 10 conversations
    
    const context = recentConversations.map(entry => {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      return `[${timestamp}] User: ${entry.userMessage}\nAssistant: ${entry.assistantMessage}`;
    }).join('\n\n');
    
    return `Recent conversations with the user:\n\n${context}`;
  }
  
  /**
   * Ask agent to analyze conversations and suggest USER.md updates
   */
  private async askAgentToAnalyze(
    conversationContext: string,
    currentUserContent: string
  ): Promise<UserMemoryAnalysis> {
    const systemPrompt = `You are analyzing conversations to update USER.md (information about the human user).

## Current USER.md:
${currentUserContent}

## Your Task:
1. Read the conversation history below
2. Identify IMPORTANT, PERSISTENT facts about the user (not temporary topics)
3. Compare with current USER.md
4. Suggest specific updates if important information is missing

## Guidelines:
- **Important facts:** Name, profession, location, long-term interests, preferences
- **Not important:** Temporary topics, one-time mentions, casual chat
- **Be conservative:** Only suggest updates for clear, repeated, or important information
- **Format suggestions:** field:value:reason (field can be: name, profession, location, interests, preferences)

## Conversation History:
${conversationContext}

## Your Analysis:
Provide a JSON response with:
1. "importantFacts": array of key facts you identified
2. "suggestedUpdates": array of {field, value, reason} 
3. "summary": brief explanation of your analysis

Example response:
{
  "importantFacts": ["User is named Dylan", "User is an IT consultant", "User likes technology and AI"],
  "suggestedUpdates": [
    {"field": "interests", "value": "AI experimentation", "reason": "User mentioned AI experimentation multiple times"}
  ],
  "summary": "User's main interests in technology and AI should be added to USER.md"
}`;

    const userMessage = `Based on the conversations above, what important information about the user should be remembered in USER.md?`;

    try {
      const messages: Message[] = [
        { role: 'user', content: userMessage, timestamp: new Date() }
      ];

      const result = await this.ollamaIntegration.complete(
        messages,
        systemPrompt,
        undefined, // taskRequirements
        undefined, // forceModel
        { temperature: 0.3 } // Lower temperature for more conservative analysis
      );

      // Parse agent response
      const response = result.response.trim();
      
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.warn('Failed to parse agent JSON response:', e);
        }
      }
      
      // Fallback: manual parsing or empty analysis
      console.log('⚠️  Agent response not in expected JSON format');
      console.log('Response:', response.substring(0, 200));
      
    } catch (error) {
      console.warn('Agent analysis failed:', error);
    }
    
    // Return empty analysis on failure
    return {
      importantFacts: [],
      suggestedUpdates: [],
      summary: 'Analysis failed or no updates needed'
    };
  }
  
  /**
   * Apply agent suggestions to USER.md
   */
  private applyAgentSuggestions(
    currentContent: string,
    analysis: UserMemoryAnalysis
  ): boolean {
    if (analysis.suggestedUpdates.length === 0) {
      return false;
    }
    
    let updatedContent = currentContent;
    let changesMade = false;
    
    for (const update of analysis.suggestedUpdates) {
      const applied = this.applySingleUpdate(updatedContent, update);
      if (applied.success) {
        updatedContent = applied.content;
        changesMade = true;
        console.log(`   ✅ Added ${update.field}: ${update.value} (${update.reason})`);
      }
    }
    
    if (changesMade) {
      // Create backup
      const backupPath = this.userPath + '.backup-' + Date.now();
      fs.writeFileSync(backupPath, currentContent, 'utf-8');
      
      // Write updated content
      fs.writeFileSync(this.userPath, updatedContent, 'utf-8');
      
      // Add update note
      const note = `\n\n<!-- Updated by agent on ${new Date().toISOString()} based on conversation analysis -->`;
      fs.appendFileSync(this.userPath, note, 'utf-8');
    }
    
    return changesMade;
  }
  
  /**
   * Apply a single update to USER.md content
   */
  private applySingleUpdate(
    content: string,
    update: { field: string; value: string; reason: string }
  ): { success: boolean; content: string } {
    const lines = content.split('\n');
    let updated = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (update.field === 'name' && line.startsWith('- **Name:**')) {
        const currentValue = line.replace('- **Name:**', '').trim();
        if (!currentValue || currentValue === '') {
          lines[i] = `- **Name:** ${update.value}`;
          updated = true;
        }
        break;
      }
      
      if (update.field === 'profession' && line.startsWith('- **Profession:**')) {
        const currentValue = line.replace('- **Profession:**', '').trim();
        if (!currentValue || currentValue === '') {
          lines[i] = `- **Profession:** ${update.value}`;
          updated = true;
        }
        break;
      }
      
      if (update.field === 'location' && line.startsWith('- **Timezone:**')) {
        const currentValue = line.replace('- **Timezone:**', '').trim();
        if (!currentValue || currentValue === '') {
          lines[i] = `- **Timezone:** ${update.value}`;
          updated = true;
        }
        break;
      }
      
      if (update.field === 'interests' && line.startsWith('- **Interests:**')) {
        const currentValue = line.replace('- **Interests:**', '').trim();
        if (currentValue === '') {
          lines[i] = `- **Interests:** ${update.value}`;
        } else if (!currentValue.toLowerCase().includes(update.value.toLowerCase())) {
          lines[i] = `- **Interests:** ${currentValue}, ${update.value}`;
        }
        updated = true;
        break;
      }
      
      if (update.field === 'preferences') {
        // Add preferences section if it doesn't exist
        if (i === lines.length - 1 || lines[i + 1].includes('---')) {
          lines.splice(i, 0, `- **Preferences:** ${update.value}`);
          updated = true;
          break;
        }
      }
    }
    
    if (updated) {
      return { success: true, content: lines.join('\n') };
    }
    
    return { success: false, content };
  }
  
  /**
   * Create default USER.md template
   */
  private createDefaultUserTemplate(): string {
    return `# USER.md - About Your Human

*Learn about the person you're helping. Update this as you go.*

- **Name:** 
- **Timezone:** 
- **Profession:** 
- **Interests:** 

---

The more I know, the better I can help. But remember — I'm learning about a person, not building a dossier. Respect the difference.`;
  }
  
  /**
   * Get current user info summary
   */
  getCurrentUserSummary(): string {
    if (!fs.existsSync(this.userPath)) {
      return 'No USER.md file found';
    }
    
    try {
      const content = fs.readFileSync(this.userPath, 'utf-8');
      const lines = content.split('\n').slice(0, 10); // First 10 lines
      return lines.join('\n');
    } catch (error) {
      return 'Error reading USER.md';
    }
  }
  
  /**
   * Manually trigger analysis
   */
  async manualUpdate(): Promise<boolean> {
    console.log('👤 Manually triggering user memory analysis...');
    return await this.analyzeAndUpdate();
  }
}