import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { Message } from '../context/types.js';

export interface SessionMemory {
  sessionId: string;
  name?: string;
  createdAt: number;
  lastAccessed: number;
  messageCount: number;
  totalTokens: number;
  tags: string[];
  metadata: Record<string, any>;
}

export interface PersistentSession {
  sessionId: string;
  messages: Message[];
  metadata: SessionMemory;
}

export class MemoryManager {
  private storagePath: string;
  private maxSessions: number;
  private pruneDays: number;

  constructor(options: {
    storagePath: string;
    maxSessions?: number;
    pruneDays?: number;
  }) {
    this.storagePath = options.storagePath;
    this.maxSessions = options.maxSessions || 100;
    this.pruneDays = options.pruneDays || 30;
    
    // Ensure storage directory exists
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }

  generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  saveSession(sessionId: string, messages: Message[], metadata: Partial<SessionMemory> = {}): void {
    const sessionFile = join(this.storagePath, `${sessionId}.json`);
    
    const sessionMemory: SessionMemory = {
      sessionId,
      name: metadata.name || `Session ${new Date().toLocaleString()}`,
      createdAt: metadata.createdAt || Date.now(),
      lastAccessed: Date.now(),
      messageCount: messages.length,
      totalTokens: messages.reduce((sum, msg) => sum + (msg.tokens || 0), 0),
      tags: metadata.tags || [],
      metadata: metadata.metadata || {},
    };

    const persistentSession: PersistentSession = {
      sessionId,
      messages,
      metadata: sessionMemory,
    };

    writeFileSync(sessionFile, JSON.stringify(persistentSession, null, 2), 'utf8');
    
    // Auto-prune old sessions
    this.pruneOldSessions();
  }

  loadSession(sessionId: string): PersistentSession | null {
    const sessionFile = join(this.storagePath, `${sessionId}.json`);
    
    try {
      if (!existsSync(sessionFile)) {
        return null;
      }
      
      const content = readFileSync(sessionFile, 'utf8');
      const session = JSON.parse(content) as PersistentSession;
      
      // Update last accessed time
      session.metadata.lastAccessed = Date.now();
      writeFileSync(sessionFile, JSON.stringify(session, null, 2), 'utf8');
      
      return session;
    } catch (error) {
      console.warn(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  }

  deleteSession(sessionId: string): boolean {
    const sessionFile = join(this.storagePath, `${sessionId}.json`);
    
    try {
      if (existsSync(sessionFile)) {
        unlinkSync(sessionFile);
        return true;
      }
    } catch (error) {
      console.warn(`Failed to delete session ${sessionId}:`, error);
    }
    
    return false;
  }

  listSessions(options?: {
    limit?: number;
    offset?: number;
    sortBy?: 'lastAccessed' | 'createdAt' | 'messageCount';
    order?: 'asc' | 'desc';
  }): SessionMemory[] {
    const files = readdirSync(this.storagePath)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        try {
          const content = readFileSync(join(this.storagePath, file), 'utf8');
          const session = JSON.parse(content) as PersistentSession;
          return session.metadata;
        } catch (error) {
          return null;
        }
      })
      .filter((metadata): metadata is SessionMemory => metadata !== null);

    // Sort
    const sortBy = options?.sortBy || 'lastAccessed';
    const order = options?.order || 'desc';
    
    files.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      
      if (order === 'desc') {
        return bVal - aVal;
      } else {
        return aVal - bVal;
      }
    });

    // Paginate
    const offset = options?.offset || 0;
    const limit = options?.limit || files.length;
    
    return files.slice(offset, offset + limit);
  }

  searchSessions(query: string, field: keyof SessionMemory = 'name'): SessionMemory[] {
    const sessions = this.listSessions();
    
    return sessions.filter(session => {
      const value = session[field];
      if (typeof value === 'string') {
        return value.toLowerCase().includes(query.toLowerCase());
      }
      return false;
    });
  }

  getSessionStats() {
    const sessions = this.listSessions();
    
    return {
      totalSessions: sessions.length,
      totalMessages: sessions.reduce((sum, session) => sum + session.messageCount, 0),
      totalTokens: sessions.reduce((sum, session) => sum + session.totalTokens, 0),
      oldestSession: sessions.length > 0 ? new Date(Math.min(...sessions.map(s => s.createdAt))) : null,
      newestSession: sessions.length > 0 ? new Date(Math.max(...sessions.map(s => s.createdAt))) : null,
      averageMessagesPerSession: sessions.length > 0 ? 
        sessions.reduce((sum, session) => sum + session.messageCount, 0) / sessions.length : 0,
    };
  }

  private pruneOldSessions(): void {
    const sessions = this.listSessions();
    
    if (sessions.length <= this.maxSessions) {
      return;
    }
    
    // Sort by last accessed (oldest first)
    sessions.sort((a, b) => a.lastAccessed - b.lastAccessed);
    
    // Delete oldest sessions
    const sessionsToDelete = sessions.slice(0, sessions.length - this.maxSessions);
    sessionsToDelete.forEach(session => {
      this.deleteSession(session.sessionId);
    });
    
    if (sessionsToDelete.length > 0) {
      console.log(`Pruned ${sessionsToDelete.length} old sessions`);
    }
    
    // Also prune by age
    const cutoff = Date.now() - (this.pruneDays * 24 * 60 * 60 * 1000);
    const oldSessions = sessions.filter(s => s.lastAccessed < cutoff);
    
    oldSessions.forEach(session => {
      this.deleteSession(session.sessionId);
    });
    
    if (oldSessions.length > 0) {
      console.log(`Deleted ${oldSessions.length} sessions older than ${this.pruneDays} days`);
    }
  }

  exportAllSessions(outputPath: string): void {
    const sessions = this.listSessions();
    const exportData = {
      exportedAt: Date.now(),
      totalSessions: sessions.length,
      sessions: sessions.map(session => {
        const fullSession = this.loadSession(session.sessionId);
        return fullSession;
      }),
    };

    writeFileSync(outputPath, JSON.stringify(exportData, null, 2), 'utf8');
  }

  importSessions(importPath: string): number {
    try {
      const content = readFileSync(importPath, 'utf8');
      const importData = JSON.parse(content);
      
      let importedCount = 0;
      
      if (importData.sessions && Array.isArray(importData.sessions)) {
        importData.sessions.forEach((session: PersistentSession) => {
          this.saveSession(session.sessionId, session.messages, session.metadata);
          importedCount++;
        });
      }
      
      return importedCount;
    } catch (error) {
      console.warn('Failed to import sessions:', error);
      return 0;
    }
  }
}