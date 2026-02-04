import fs from 'fs';
import path from 'path';
import { FileSecurityManager } from '../security/encryption-manager.js';
import { SecureKeyManager, getEncryptionKeyFromSecureStorage } from '../security/secure-key-manager.js';

export interface Identity {
  soul?: string;
  user?: string;
  identity?: string;
  memory?: string[];
  recentMemory?: string[];
}

export interface FileLoaderOptions {
  workspacePath?: string;
  identityPath?: string;
  memoryPath?: string;
}

export class FileLoader {
  private workspacePath: string;
  private identityPath: string;
  private memoryPath: string;
  private identityRelativePath: string | null;
  private securityManager: FileSecurityManager | null = null;
  private keyManager: SecureKeyManager;
  private encryptionEnabled: boolean = false;
  
  constructor(options: string | FileLoaderOptions = process.cwd()) {
    const workspacePath = typeof options === 'string'
      ? options
      : options.workspacePath || process.cwd();
    const identityPath = typeof options === 'string'
      ? workspacePath
      : options.identityPath || workspacePath;
    const memoryPath = typeof options === 'string'
      ? path.join(workspacePath, 'memory')
      : options.memoryPath || path.join(workspacePath, 'memory');

    this.workspacePath = workspacePath;
    this.identityPath = identityPath;
    this.memoryPath = memoryPath;
    this.identityRelativePath = this.getRelativePath(identityPath);
    this.keyManager = new SecureKeyManager();
    
    // Check if we have encryption available
    this.encryptionEnabled = this.keyManager.isSecureStorageAvailable();
    
    if (this.encryptionEnabled) {
      // Try to get encryption key
      const encryptionKey = getEncryptionKeyFromSecureStorage();
      if (encryptionKey) {
        this.securityManager = new FileSecurityManager(this.workspacePath, encryptionKey);
      } else {
        console.warn('⚠️  Secure storage exists but encryption key not accessible');
      }
    }
  }
  
  isEncryptionAvailable(): boolean {
    return this.encryptionEnabled && this.securityManager !== null;
  }
  
  async ensureEncryptedFiles(): Promise<void> {
    if (this.securityManager) {
      // Check and encrypt sensitive files
      const identityFiles = [
        'SOUL.md',
        'USER.md',
        'IDENTITY.md',
        'AGENTS.md',
        'TOOLS.md',
        'HEARTBEAT.md'
      ];
      
      for (const file of identityFiles) {
        const filePath = path.join(this.identityPath, file);
        if (fs.existsSync(filePath)) {
          const relative = this.toSecureRelativePath(this.identityRelativePath, file);
          if (relative) {
            this.securityManager.ensureEncrypted(relative);
          }
        }
      }

      const memoryFilePath = path.join(this.workspacePath, 'MEMORY.md');
      if (fs.existsSync(memoryFilePath)) {
        this.securityManager.ensureEncrypted('MEMORY.md');
      }
      
      // Check memory directory
      const memoryDir = this.memoryPath;
      if (fs.existsSync(memoryDir)) {
        const files = fs.readdirSync(memoryDir)
          .filter(file => file.endsWith('.md') && file.match(/^\d{4}-\d{2}-\d{2}\.md$/));
        
        for (const file of files) {
          const memoryFile = path.join(memoryDir, file);
          const relativePath = this.getRelativePath(memoryFile);
          if (relativePath) {
            this.securityManager.ensureEncrypted(relativePath);
          }
        }
      }
    }
  }
  
  async loadIdentity(): Promise<Identity> {
    const identity: Identity = {};
    
    try {
      if (this.securityManager) {
        await this.ensureEncryptedFiles();
      }
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
    if (this.securityManager) {
      await this.ensureEncryptedFiles();
    }
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
  - You can access workspace files via tools (use the read tool when asked)
  - Never claim you cannot access local files when a tool can read them
`);
    
    return parts.join('\n');
  }
  
  private async readFileIfExists(filename: string): Promise<string | undefined> {
    const filePath = path.join(this.identityPath, filename);
    
    if (fs.existsSync(filePath)) {
      try {
        if (this.securityManager) {
          const relative = this.toSecureRelativePath(this.identityRelativePath, filename);
          if (relative) {
            return this.securityManager.readSecureFile(relative);
          }
        }
        return fs.readFileSync(filePath, 'utf-8');
      } catch (error) {
        console.warn(`Failed to read ${filename}:`, error instanceof Error ? error.message : String(error));
        return undefined;
      }
    }
    
    return undefined;
  }
  
  private async loadMemoryFiles(): Promise<string[]> {
    const memoryDir = this.memoryPath;
    const memories: string[] = [];
    
    if (!fs.existsSync(memoryDir)) {
      return memories;
    }
    
    try {
      // Read MEMORY.md first (long-term curated memory)
      const memoryFile = path.join(this.workspacePath, 'MEMORY.md');
      if (fs.existsSync(memoryFile)) {
        const content = this.securityManager
          ? this.securityManager.readSecureFile('MEMORY.md')
          : fs.readFileSync(memoryFile, 'utf-8');
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
        const relative = this.getRelativePath(filePath);
        const content = this.securityManager && relative
          ? this.securityManager.readSecureFile(relative)
          : fs.readFileSync(filePath, 'utf-8');
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
    const memoryDir = this.memoryPath;
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
        const relative = this.getRelativePath(todayFile);
        const content = this.securityManager && relative
          ? this.securityManager.readSecureFile(relative)
          : fs.readFileSync(todayFile, 'utf-8');
        recent.push(`[Today ${todayStr}] ${content.substring(0, 800)}${content.length > 800 ? '...' : ''}`);
      }
      
      // Load yesterday's memory
      const yesterdayFile = path.join(memoryDir, `${yesterdayStr}.md`);
      if (fs.existsSync(yesterdayFile)) {
        const relative = this.getRelativePath(yesterdayFile);
        const content = this.securityManager && relative
          ? this.securityManager.readSecureFile(relative)
          : fs.readFileSync(yesterdayFile, 'utf-8');
        recent.push(`[Yesterday ${yesterdayStr}] ${content.substring(0, 800)}${content.length > 800 ? '...' : ''}`);
      }
      
    } catch (error) {
      console.warn('Failed to load recent memory:', error instanceof Error ? error.message : String(error));
    }
    
    return recent;
  }
  
  async updateMemory(entry: string): Promise<void> {
    const memoryDir = this.memoryPath;
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
      
      if (this.securityManager) {
        const relative = this.getRelativePath(todayFile);
        const existing = relative && fs.existsSync(todayFile) ? this.securityManager.readSecureFile(relative) : '';
        if (relative) {
          this.securityManager.writeSecureFile(relative, existing + memoryEntry);
        } else {
          fs.appendFileSync(todayFile, memoryEntry, 'utf-8');
        }
      } else {
        fs.appendFileSync(todayFile, memoryEntry, 'utf-8');
      }
      
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
      
      if (this.securityManager) {
        const relative = this.getRelativePath(memoryFile);
        const existing = relative && fs.existsSync(memoryFile)
          ? this.securityManager.readSecureFile(relative)
          : '# MEMORY.md - Long-Term Memory\n\n';
        if (relative) {
          this.securityManager.writeSecureFile(relative, existing + memoryEntry);
        } else {
          fs.appendFileSync(memoryFile, memoryEntry, 'utf-8');
        }
      } else {
        fs.appendFileSync(memoryFile, memoryEntry, 'utf-8');
      }
      
    } catch (error) {
      console.error('Failed to update long-term memory:', error instanceof Error ? error.message : String(error));
    }
  }

  private getRelativePath(targetPath: string): string | null {
    const relative = path.relative(this.workspacePath, targetPath).replace(/\\/g, '/');
    if (!relative || relative === '') {
      return '';
    }
    if (relative.startsWith('..')) {
      return null;
    }
    return relative;
  }

  private toSecureRelativePath(baseRelative: string | null, filename: string): string | null {
    if (baseRelative === null) {
      return null;
    }
    if (!baseRelative) {
      return filename;
    }
    return path.posix.join(baseRelative, filename);
  }
}

// Export a simple function to get system prompt
export async function getSystemPrompt(workspacePath?: string): Promise<string> {
  const loader = new FileLoader(workspacePath);
  return loader.constructSystemPrompt();
}