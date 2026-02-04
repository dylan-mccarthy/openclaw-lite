/**
 * User Info Updater for OpenClaw Lite
 * Analyzes conversations and suggests updates to USER.md with user approval
 */

import fs from 'fs';
import path from 'path';

export interface UserInfoSuggestion {
  field: string;
  currentValue?: string;
  suggestedValue: string;
  confidence: number; // 0-1
  source: string; // Which conversation it came from
  timestamp: Date;
}

export interface UserInfoAnalysis {
  name?: string;
  profession?: string;
  interests: string[];
  location?: string;
  projects?: string[];
  preferences?: string[];
  suggestions: UserInfoSuggestion[];
}

export class UserInfoUpdater {
  private userPath: string;
  private conversationLogPath: string;
  private suggestionsPath: string;
  private analysisInterval: number = 20; // Analyze every 20 conversations
  
  constructor(private workspaceDir: string) {
    const identityDir = path.join(workspaceDir, 'identity');
    this.userPath = path.join(identityDir, 'USER.md');
    this.conversationLogPath = path.join(identityDir, 'conversations.log');
    this.suggestionsPath = path.join(identityDir, 'user-suggestions.json');
    
    // Ensure directories exist
    if (!fs.existsSync(identityDir)) {
      fs.mkdirSync(identityDir, { recursive: true });
    }
  }
  
  /**
   * Analyze conversations for user information
   */
  analyzeUserInfo(): UserInfoAnalysis {
    const analysis: UserInfoAnalysis = {
      interests: [],
      suggestions: []
    };
    
    try {
      if (!fs.existsSync(this.conversationLogPath)) {
        return analysis;
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
        .slice(-this.analysisInterval); // Last N conversations
      
      if (entries.length < 5) {
        console.log('📝 Not enough conversations for user info analysis');
        return analysis;
      }
      
      // Analyze each conversation for user info
      for (const entry of entries) {
        const userMessage = entry.userMessage.toLowerCase();
        
        // Extract potential name mentions
        if (userMessage.includes('my name is') || userMessage.includes('i\'m ') || userMessage.includes('i am ')) {
          const nameMatch = userMessage.match(/(?:my name is|i['’]m|i am) ([a-zA-Z]+)/);
          if (nameMatch && nameMatch[1]) {
            analysis.suggestions.push({
              field: 'name',
              suggestedValue: this.capitalize(nameMatch[1]),
              confidence: 0.8,
              source: `Conversation: "${entry.userMessage.substring(0, 50)}..."`,
              timestamp: new Date(entry.timestamp)
            });
          }
        }
        
        // Extract profession/job
        if (userMessage.includes('i work') || userMessage.includes('my job') || userMessage.includes('i\'m a')) {
          const jobMatch = userMessage.match(/(?:i work as|my job is|i['’]m a) ([a-zA-Z\s]+)/);
          if (jobMatch && jobMatch[1]) {
            analysis.suggestions.push({
              field: 'profession',
              suggestedValue: this.capitalize(jobMatch[1].trim()),
              confidence: 0.7,
              source: `Conversation: "${entry.userMessage.substring(0, 50)}..."`,
              timestamp: new Date(entry.timestamp)
            });
          }
        }
        
        // Extract interests/hobbies
        const interestKeywords = ['like', 'love', 'enjoy', 'interested in', 'hobby', 'into'];
        for (const keyword of interestKeywords) {
          if (userMessage.includes(keyword)) {
            // Simple extraction - in real implementation, use more sophisticated NLP
            const context = userMessage.substring(
              Math.max(0, userMessage.indexOf(keyword) - 50),
              Math.min(userMessage.length, userMessage.indexOf(keyword) + 100)
            );
            
            // Common interests to look for
            const commonInterests = [
              'gaming', 'games', 'video games', 'pc gaming',
              'coding', 'programming', 'software',
              'music', 'metal', 'rock', 'jazz',
              'movies', 'tv shows', 'anime',
              'sports', 'basketball', 'soccer',
              'reading', 'books', 'writing',
              'cooking', 'baking', 'food',
              'travel', 'hiking', 'outdoors',
              'tech', 'technology', 'ai', 'robotics',
              'art', 'drawing', 'painting',
              'photography', 'cars', 'motorcycles'
            ];
            
            for (const interest of commonInterests) {
              if (context.includes(interest) && !analysis.interests.includes(interest)) {
                analysis.interests.push(interest);
                analysis.suggestions.push({
                  field: 'interests',
                  suggestedValue: interest,
                  confidence: 0.6,
                  source: `Conversation about "${keyword}": "${context.substring(0, 50)}..."`,
                  timestamp: new Date(entry.timestamp)
                });
              }
            }
          }
        }
        
        // Extract location/timezone hints
        if (userMessage.includes('australia') || userMessage.includes('melbourne') || 
            userMessage.includes('sydney') || userMessage.includes('aest')) {
          analysis.suggestions.push({
            field: 'location',
            suggestedValue: 'Australia/Melbourne',
            confidence: 0.9,
            source: `Mentioned location in: "${entry.userMessage.substring(0, 50)}..."`,
            timestamp: new Date(entry.timestamp)
          });
        }
      }
      
      // Load current USER.md to compare
      if (fs.existsSync(this.userPath)) {
        const currentUser = this.loadCurrentUserInfo();
        analysis.name = currentUser.name;
        analysis.profession = currentUser.profession;
        analysis.location = currentUser.location;
        
        // Filter out suggestions that already exist
        analysis.suggestions = analysis.suggestions.filter(suggestion => {
          if (suggestion.field === 'name' && currentUser.name && 
              currentUser.name.toLowerCase().includes(suggestion.suggestedValue.toLowerCase())) {
            return false;
          }
          if (suggestion.field === 'profession' && currentUser.profession &&
              currentUser.profession.toLowerCase().includes(suggestion.suggestedValue.toLowerCase())) {
            return false;
          }
          if (suggestion.field === 'location' && currentUser.location &&
              currentUser.location.toLowerCase().includes(suggestion.suggestedValue.toLowerCase())) {
            return false;
          }
          if (suggestion.field === 'interests' && currentUser.interests &&
              currentUser.interests.some(i => i.toLowerCase().includes(suggestion.suggestedValue.toLowerCase()))) {
            return false;
          }
          return true;
        });
      }
      
      // Save suggestions for review
      this.saveSuggestions(analysis.suggestions);
      
    } catch (error) {
      console.warn('Failed to analyze user info:', error);
    }
    
    return analysis;
  }
  
  /**
   * Load current user info from USER.md
   */
  private loadCurrentUserInfo(): {
    name?: string;
    profession?: string;
    location?: string;
    interests: string[];
  } {
    const result: {
      name?: string;
      profession?: string;
      location?: string;
      interests: string[];
    } = {
      interests: []
    };
    
    if (!fs.existsSync(this.userPath)) {
      return result;
    }
    
    try {
      const content = fs.readFileSync(this.userPath, 'utf-8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        if (line.includes('**Name:**')) {
          result.name = line.replace('**Name:**', '').trim();
        } else if (line.includes('**Profession:**')) {
          result.profession = line.replace('**Profession:**', '').trim();
        } else if (line.includes('**Timezone:**')) {
          result.location = line.replace('**Timezone:**', '').trim();
        } else if (line.includes('**Interests:**')) {
          const interestsLine = line.replace('**Interests:**', '').trim();
          if (interestsLine) {
            result.interests = interestsLine.split(',').map(i => i.trim());
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse USER.md:', error);
    }
    
    return result;
  }
  
  /**
   * Save suggestions for user review
   */
  private saveSuggestions(suggestions: UserInfoSuggestion[]): void {
    if (suggestions.length === 0) {
      return;
    }
    
    const data = {
      timestamp: new Date().toISOString(),
      suggestions: suggestions.map(s => ({
        ...s,
        timestamp: s.timestamp.toISOString()
      }))
    };
    
    fs.writeFileSync(this.suggestionsPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`💡 Saved ${suggestions.length} user info suggestions for review`);
  }
  
  /**
   * Get pending suggestions
   */
  getPendingSuggestions(): UserInfoSuggestion[] {
    if (!fs.existsSync(this.suggestionsPath)) {
      return [];
    }
    
    try {
      const data = JSON.parse(fs.readFileSync(this.suggestionsPath, 'utf-8'));
      return data.suggestions.map((s: any) => ({
        ...s,
        timestamp: new Date(s.timestamp)
      }));
    } catch (error) {
      return [];
    }
  }
  
  /**
   * Apply a suggestion to USER.md (with user approval)
   */
  applySuggestion(suggestion: UserInfoSuggestion): boolean {
    try {
      if (!fs.existsSync(this.userPath)) {
        // Create basic USER.md if it doesn't exist
        const basicTemplate = `# USER.md - About Your Human

*Learn about the person you're helping. Update this as you go.*

- **Name:** 
- **Timezone:** 
- **Profession:** 
- **Interests:** 

---

The more I know, the better I can help. But remember — I'm learning about a person, not building a dossier. Respect the difference.`;
        
        fs.writeFileSync(this.userPath, basicTemplate, 'utf-8');
      }
      
      let content = fs.readFileSync(this.userPath, 'utf-8');
      const lines = content.split('\n');
      let updated = false;
      
      // Find and update the relevant field
      for (let i = 0; i < lines.length; i++) {
        if (suggestion.field === 'name' && lines[i].includes('**Name:**')) {
          lines[i] = `- **Name:** ${suggestion.suggestedValue}`;
          updated = true;
          break;
        } else if (suggestion.field === 'profession' && lines[i].includes('**Profession:**')) {
          lines[i] = `- **Profession:** ${suggestion.suggestedValue}`;
          updated = true;
          break;
        } else if (suggestion.field === 'location' && lines[i].includes('**Timezone:**')) {
          lines[i] = `- **Timezone:** ${suggestion.suggestedValue}`;
          updated = true;
          break;
        } else if (suggestion.field === 'interests' && lines[i].includes('**Interests:**')) {
          const current = lines[i].replace('**Interests:**', '').trim();
          if (current) {
            lines[i] = `- **Interests:** ${current}, ${suggestion.suggestedValue}`;
          } else {
            lines[i] = `- **Interests:** ${suggestion.suggestedValue}`;
          }
          updated = true;
          break;
        }
      }
      
      if (updated) {
        content = lines.join('\n');
        fs.writeFileSync(this.userPath, content, 'utf-8');
        
        // Remove this suggestion from pending
        this.removeSuggestion(suggestion);
        
        console.log(`✅ Updated USER.md with ${suggestion.field}: ${suggestion.suggestedValue}`);
        return true;
      }
      
    } catch (error) {
      console.warn('Failed to apply suggestion:', error);
    }
    
    return false;
  }
  
  /**
   * Remove a suggestion from pending list
   */
  private removeSuggestion(suggestion: UserInfoSuggestion): void {
    const suggestions = this.getPendingSuggestions();
    const remaining = suggestions.filter(s => 
      !(s.field === suggestion.field && 
        s.suggestedValue === suggestion.suggestedValue &&
        s.timestamp.getTime() === suggestion.timestamp.getTime())
    );
    
    if (remaining.length === 0) {
      // No more suggestions, delete the file
      if (fs.existsSync(this.suggestionsPath)) {
        fs.unlinkSync(this.suggestionsPath);
      }
    } else {
      // Save remaining suggestions
      const data = {
        timestamp: new Date().toISOString(),
        suggestions: remaining.map(s => ({
          ...s,
          timestamp: s.timestamp.toISOString()
        }))
      };
      fs.writeFileSync(this.suggestionsPath, JSON.stringify(data, null, 2), 'utf-8');
    }
  }
  
  /**
   * Reject a suggestion
   */
  rejectSuggestion(suggestion: UserInfoSuggestion): void {
    this.removeSuggestion(suggestion);
    console.log(`❌ Rejected suggestion: ${suggestion.field}: ${suggestion.suggestedValue}`);
  }
  
  /**
   * Clear all pending suggestions
   */
  clearSuggestions(): void {
    if (fs.existsSync(this.suggestionsPath)) {
      fs.unlinkSync(this.suggestionsPath);
      console.log('🧹 Cleared all user info suggestions');
    }
  }
  
  /**
   * Manually trigger analysis
   */
  manualAnalyze(): UserInfoAnalysis {
    console.log('🔍 Manually analyzing user info from conversations...');
    return this.analyzeUserInfo();
  }
  
  /**
   * Helper: Capitalize first letter
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}