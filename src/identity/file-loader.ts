import fs from 'fs';
import path from 'path';

export interface Identity {
  soul?: string;
  user?: string;
  identity?: string;
  memory?: string[];
  recentMemory?: string[];
}

export class FileLoader {
  private workspacePath: string;
  
  constructor(workspacePath: string = process.cwd()) {
    this.workspacePath = workspacePath;
  }
  
  async loadIdentity(): Promise<Identity> {
    const identity: Identity = {};
    
    try {
      // 1. Load SOUL.md (who you are)
      identity.soul = await this.readFileIfExists('SOUL.md');
      
      // 2. Load USER.md (who you're helping)
      identity.user = await this.readFileIfExists('USER.md');
      
      // 3. Load IDENTITY.md (metadata)
      identity.identity = await this.readFileIfExists('IDENTITY.md');
      
      // 4. Load MEMORY.md (long-term memory)
      identity.memory = await this.loadMemoryFiles();
      
      // 5. Load recent memory (today + yesterday)
      identity.recentMemory = await this.loadRecentMemory();
      
    } catch (error) {
      console.warn('Warning: Failed to load some identity files:', error instanceof Error ? error.message : String(error));
    }
    
    return identity;
  }
  
  async constructSystemPrompt(): Promise<string> {
    const identity = await this.loadIdentity();
    const parts: string[] = [];
    
    // Start with SOUL.md if it exists
    if (identity.soul) {
      parts.push(identity.soul);
    } else {
      // Default prompt if no SOUL.md
      parts.push(`You are a helpful AI assistant. Be concise, resourceful, and proactive.`);
    }
    
    // Add USER.md context if it exists
    if (identity.user) {
      parts.push(`\n## About the person you're helping:\n${identity.user}`);
    }
    
    // Add recent memory if it exists
    if (identity.recentMemory && identity.recentMemory.length > 0) {
      parts.push(`\n## Recent context:\n${identity.recentMemory.join('\n')}`);
    }
    
    // Add memory summary if it exists
    if (identity.memory && identity.memory.length > 0) {
      parts.push(`\n## Long-term context (summary):\n${identity.memory.slice(0, 3).join('\n')}`);
      if (identity.memory.length > 3) {
        parts.push(`... and ${identity.memory.length - 3} more memory entries.`);
      }
    }
    
    // Add instructions
    parts.push(`
## Instructions:
- Be resourceful: try to figure things out before asking
- Have opinions and personality (based on SOUL.md)
- Respect privacy and boundaries
- When in doubt about external actions, ask first
- Use available tools when appropriate
- Keep responses concise but thorough when needed
`);
    
    return parts.join('\n');
  }
  
  private async readFileIfExists(filename: string): Promise<string | undefined> {
    const filePath = path.join(this.workspacePath, filename);
    
    if (fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath, 'utf-8');
      } catch (error) {
        console.warn(`Failed to read ${filename}:`, error instanceof Error ? error.message : String(error));
        return undefined;
      }
    }
    
    return undefined;
  }
  
  private async loadMemoryFiles(): Promise<string[]> {
    const memoryDir = path.join(this.workspacePath, 'memory');
    const memories: string[] = [];
    
    if (!fs.existsSync(memoryDir)) {
      return memories;
    }
    
    try {
      // Read MEMORY.md first (long-term curated memory)
      const memoryFile = path.join(this.workspacePath, 'MEMORY.md');
      if (fs.existsSync(memoryFile)) {
        const content = fs.readFileSync(memoryFile, 'utf-8');
        // Take first 1000 chars as summary
        memories.push(content.substring(0, 1000) + (content.length > 1000 ? '...' : ''));
      }
      
      // Read memory directory files (sorted by date, newest first)
      const files = fs.readdirSync(memoryDir)
        .filter(file => file.endsWith('.md') && file.match(/^\d{4}-\d{2}-\d{2}\.md$/))
        .sort()
        .reverse()
        .slice(0, 5); // Last 5 days
      
      for (const file of files) {
        const filePath = path.join(memoryDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const date = file.replace('.md', '');
        // Take first 500 chars per file
        const preview = content.substring(0, 500) + (content.length > 500 ? '...' : '');
        memories.push(`[${date}] ${preview}`);
      }
      
    } catch (error) {
      console.warn('Failed to load memory files:', error instanceof Error ? error.message : String(error));
    }
    
    return memories;
  }
  
  private async loadRecentMemory(): Promise<string[]> {
    const memoryDir = path.join(this.workspacePath, 'memory');
    const recent: string[] = [];
    
    if (!fs.existsSync(memoryDir)) {
      return recent;
    }
    
    try {
      // Get today's and yesterday's dates
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const dateFormat = (date: Date) => date.toISOString().split('T')[0];
      const todayStr = dateFormat(today);
      const yesterdayStr = dateFormat(yesterday);
      
      // Load today's memory
      const todayFile = path.join(memoryDir, `${todayStr}.md`);
      if (fs.existsSync(todayFile)) {
        const content = fs.readFileSync(todayFile, 'utf-8');
        recent.push(`[Today ${todayStr}] ${content.substring(0, 800)}${content.length > 800 ? '...' : ''}`);
      }
      
      // Load yesterday's memory
      const yesterdayFile = path.join(memoryDir, `${yesterdayStr}.md`);
      if (fs.existsSync(yesterdayFile)) {
        const content = fs.readFileSync(yesterdayFile, 'utf-8');
        recent.push(`[Yesterday ${yesterdayStr}] ${content.substring(0, 800)}${content.length > 800 ? '...' : ''}`);
      }
      
    } catch (error) {
      console.warn('Failed to load recent memory:', error instanceof Error ? error.message : String(error));
    }
    
    return recent;
  }
  
  async updateMemory(entry: string): Promise<void> {
    const memoryDir = path.join(this.workspacePath, 'memory');
    const today = new Date().toISOString().split('T')[0];
    const todayFile = path.join(memoryDir, `${today}.md`);
    
    try {
      // Create memory directory if it doesn't exist
      if (!fs.existsSync(memoryDir)) {
        fs.mkdirSync(memoryDir, { recursive: true });
      }
      
      // Append to today's memory file
      const timestamp = new Date().toISOString();
      const memoryEntry = `\n\n---\n[${timestamp}] ${entry}`;
      
      fs.appendFileSync(todayFile, memoryEntry, 'utf-8');
      
    } catch (error) {
      console.error('Failed to update memory:', error instanceof Error ? error.message : String(error));
    }
  }
  
  async updateLongTermMemory(entry: string): Promise<void> {
    const memoryFile = path.join(this.workspacePath, 'MEMORY.md');
    
    try {
      // Create MEMORY.md if it doesn't exist
      if (!fs.existsSync(memoryFile)) {
        fs.writeFileSync(memoryFile, '# MEMORY.md - Long-Term Memory\n\n', 'utf-8');
      }
      
      // Append to MEMORY.md
      const timestamp = new Date().toISOString();
      const memoryEntry = `\n\n## ${timestamp}\n${entry}`;
      
      fs.appendFileSync(memoryFile, memoryEntry, 'utf-8');
      
    } catch (error) {
      console.error('Failed to update long-term memory:', error instanceof Error ? error.message : String(error));
    }
  }
}

// Export a simple function to get system prompt
export async function getSystemPrompt(workspacePath?: string): Promise<string> {
  const loader = new FileLoader(workspacePath);
  return loader.constructSystemPrompt();
}