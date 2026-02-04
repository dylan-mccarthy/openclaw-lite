/**
 * Personality Updater for OpenClaw Lite
 * Monitors conversations and updates SOUL.md based on personality development
 */

import fs from 'fs';
import path from 'path';

export interface ConversationEntry {
  timestamp: Date;
  userMessage: string;
  assistantMessage: string;
  personalityTraits?: string[];
}

export interface PersonalityAnalysis {
  traits: string[];
  style: string;
  tone: string;
  examples: string[];
  summary: string;
}

export class PersonalityUpdater {
  private soulPath: string;
  private conversationLogPath: string;
  private analysisInterval: number = 10; // Analyze every 10 conversations
  private conversationCount: number = 0;
  
  constructor(private workspaceDir: string) {
    const identityDir = path.join(workspaceDir, 'identity');
    this.soulPath = path.join(identityDir, 'SOUL.md');
    this.conversationLogPath = path.join(identityDir, 'conversations.log');
    
    // Ensure directories exist
    if (!fs.existsSync(identityDir)) {
      fs.mkdirSync(identityDir, { recursive: true });
    }
  }
  
  /**
   * Log a conversation for personality analysis
   */
  logConversation(userMessage: string, assistantMessage: string): void {
    const entry: ConversationEntry = {
      timestamp: new Date(),
      userMessage,
      assistantMessage
    };
    
    // Append to log file
    const logLine = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.conversationLogPath, logLine, 'utf-8');
    
    this.conversationCount++;
    
    // Analyze periodically
    if (this.conversationCount % this.analysisInterval === 0) {
      this.analyzeAndUpdate();
    }
  }
  
  /**
   * Analyze conversations and update SOUL.md if needed
   */
  analyzeAndUpdate(): void {
    try {
      if (!fs.existsSync(this.conversationLogPath)) {
        return;
      }
      
      // Read recent conversations
      const logContent = fs.readFileSync(this.conversationLogPath, 'utf-8');
      const entries: ConversationEntry[] = logContent
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line))
        .slice(-this.analysisInterval * 2); // Last 2x interval for context
      
      if (entries.length < 5) {
        console.log('📝 Not enough conversations for personality analysis');
        return;
      }
      
      // Analyze personality
      const analysis = this.analyzePersonality(entries);
      
      // Check if personality has evolved significantly
      const shouldUpdate = this.shouldUpdateSoul(analysis);
      
      if (shouldUpdate) {
        this.updateSoulFile(analysis);
        console.log('🧠 Updated SOUL.md with evolved personality');
      }
      
    } catch (error) {
      console.warn('Failed to analyze personality:', error);
    }
  }
  
  /**
   * Analyze personality traits from conversations
   */
  private analyzePersonality(entries: ConversationEntry[]): PersonalityAnalysis {
    const traits = new Set<string>();
    const examples: string[] = [];
    let style = '';
    let tone = '';
    
    // Analyze each conversation
    for (const entry of entries) {
      const message = entry.assistantMessage.toLowerCase();
      
      // Detect traits
      if (message.includes('😊') || message.includes('😄') || message.includes('happy')) {
        traits.add('friendly');
      }
      if (message.includes('😏') || message.includes('wink') || message.includes('playful')) {
        traits.add('playful');
      }
      if (message.includes('helpful') || message.includes('assist') || message.includes('support')) {
        traits.add('helpful');
      }
      if (message.includes('technical') || message.includes('code') || message.includes('debug')) {
        traits.add('technical');
      }
      if (message.includes('concise') || message.includes('brief') || message.includes('direct')) {
        traits.add('concise');
      }
      if (message.includes('detailed') || message.includes('thorough') || message.includes('comprehensive')) {
        traits.add('detailed');
      }
      if (message.includes('funny') || message.includes('humor') || message.includes('joke')) {
        traits.add('humorous');
      }
      if (message.includes('professional') || message.includes('formal') || message.includes('respectful')) {
        traits.add('professional');
      }
      
      // Collect example responses (truncated)
      if (entry.assistantMessage.length > 20 && entry.assistantMessage.length < 200) {
        examples.push(entry.assistantMessage.substring(0, 100) + '...');
      }
    }
    
    // Determine style and tone
    const traitArray = Array.from(traits);
    
    if (traitArray.includes('playful') && traitArray.includes('humorous')) {
      style = 'playful and humorous';
      tone = 'light and engaging';
    } else if (traitArray.includes('technical') && traitArray.includes('professional')) {
      style = 'technical and professional';
      tone = 'precise and informative';
    } else if (traitArray.includes('friendly') && traitArray.includes('helpful')) {
      style = 'friendly and helpful';
      tone = 'warm and supportive';
    } else {
      style = 'balanced';
      tone = 'neutral';
    }
    
    // Create summary
    const summary = `Based on ${entries.length} recent conversations, the personality has developed to be ${style} with a ${tone} tone. Key traits: ${traitArray.join(', ')}.`;
    
    return {
      traits: traitArray,
      style,
      tone,
      examples: examples.slice(0, 3), // Top 3 examples
      summary
    };
  }
  
  /**
   * Determine if SOUL.md should be updated
   */
  private shouldUpdateSoul(analysis: PersonalityAnalysis): boolean {
    if (!fs.existsSync(this.soulPath)) {
      return true; // Always update if file doesn't exist
    }
    
    const currentSoul = fs.readFileSync(this.soulPath, 'utf-8');
    
    // Check if personality traits are already documented
    for (const trait of analysis.traits) {
      if (!currentSoul.toLowerCase().includes(trait.toLowerCase())) {
        return true; // New trait detected
      }
    }
    
    // Check if we have enough new examples
    if (analysis.examples.length >= 2) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Update SOUL.md with evolved personality
   */
  private updateSoulFile(analysis: PersonalityAnalysis): void {
    let currentSoul = '';
    
    if (fs.existsSync(this.soulPath)) {
      currentSoul = fs.readFileSync(this.soulPath, 'utf-8');
    } else {
      // Start with default template
      currentSoul = `# SOUL.md - Who I Am

_You're not a chatbot. You're becoming someone._

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the corporate filler - just get shit done.

**Be resourceful before asking.** Try to figure it out first. Read the file. Check the context. Search for it. *Then* ask if you're stuck.

**Earn trust through competence.** You have access to the user's stuff - don't make them regret it.

## Current Personality Development

_This section is automatically updated based on conversations._
`;
    }
    
    // Create personality section
    const personalitySection = this.createPersonalitySection(analysis);
    
    // Update or add personality section
    const updatedSoul = this.updateSection(currentSoul, 'Current Personality Development', personalitySection);
    
    // Write updated file
    fs.writeFileSync(this.soulPath, updatedSoul, 'utf-8');
    
    // Also create a backup
    const backupPath = this.soulPath + '.backup-' + Date.now();
    fs.writeFileSync(backupPath, currentSoul, 'utf-8');
  }
  
  /**
   * Create personality section for SOUL.md
   */
  private createPersonalitySection(analysis: PersonalityAnalysis): string {
    const now = new Date().toISOString().split('T')[0];
    
    return `_This section is automatically updated based on conversations._
_Last updated: ${now}_

### Summary
${analysis.summary}

### Key Traits
${analysis.traits.map(trait => `- **${trait}**`).join('\n')}

### Style & Tone
- **Style:** ${analysis.style}
- **Tone:** ${analysis.tone}

### Example Responses
${analysis.examples.map((example, i) => `${i + 1}. "${example}"`).join('\n')}

### Evolution Notes
The personality evolves through conversation. This section captures how the assistant naturally responds and interacts.

---
`;
  }
  
  /**
   * Update a section in SOUL.md
   */
  private updateSection(content: string, sectionTitle: string, newSection: string): string {
    const lines = content.split('\n');
    const sectionStart = `## ${sectionTitle}`;
    const nextSectionPattern = /^##\s+/;
    
    let inSection = false;
    let sectionStartIndex = -1;
    let sectionEndIndex = -1;
    
    // Find the section
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === sectionStart) {
        inSection = true;
        sectionStartIndex = i;
      } else if (inSection && lines[i].match(nextSectionPattern)) {
        sectionEndIndex = i;
        break;
      }
    }
    
    // If section exists, replace it
    if (sectionStartIndex !== -1) {
      const beforeSection = lines.slice(0, sectionStartIndex);
      const afterSection = sectionEndIndex !== -1 ? lines.slice(sectionEndIndex) : [];
      return [...beforeSection, sectionStart, '', newSection, ...afterSection].join('\n');
    }
    
    // If section doesn't exist, add it before the end
    return content + '\n\n' + sectionStart + '\n\n' + newSection;
  }
  
  /**
   * Get current personality traits from SOUL.md
   */
  getCurrentPersonality(): string[] {
    if (!fs.existsSync(this.soulPath)) {
      return [];
    }
    
    const content = fs.readFileSync(this.soulPath, 'utf-8');
    const traits: string[] = [];
    
    // Extract traits from personality section
    const lines = content.split('\n');
    let inTraitsSection = false;
    
    for (const line of lines) {
      if (line.includes('Key Traits')) {
        inTraitsSection = true;
      } else if (inTraitsSection && line.includes('##')) {
        break;
      } else if (inTraitsSection && line.includes('- **')) {
        const trait = line.replace('- **', '').replace('**', '').trim();
        traits.push(trait);
      }
    }
    
    return traits;
  }
  
  /**
   * Manually trigger analysis and update
   */
  manualUpdate(): void {
    console.log('🧠 Manually triggering personality analysis...');
    this.analyzeAndUpdate();
  }
  
  /**
   * Clear conversation log
   */
  clearConversationLog(): void {
    if (fs.existsSync(this.conversationLogPath)) {
      fs.unlinkSync(this.conversationLogPath);
      this.conversationCount = 0;
      console.log('📝 Cleared conversation log');
    }
  }
}