import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export interface PairingEntry {
  chatId: string;
  createdAt: number;
  expiresAt: number;
}

interface PairingState {
  allowlist: string[];
  pending: Record<string, PairingEntry>;
}

export class TelegramPairingStore {
  private storeFile: string;
  private state: PairingState = { allowlist: [], pending: {} };

  constructor(storagePath: string) {
    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
    }

    this.storeFile = path.join(storagePath, 'telegram-pairing.json');
    this.load();
  }

  isAllowed(chatId: string): boolean {
    return this.state.allowlist.includes(chatId);
  }

  getAllowlist(): string[] {
    return [...this.state.allowlist];
  }

  listPending(): Array<{ code: string; entry: PairingEntry }> {
    this.pruneExpired();
    return Object.entries(this.state.pending).map(([code, entry]) => ({ code, entry }));
  }

  addAllowed(chatId: string): void {
    if (!this.state.allowlist.includes(chatId)) {
      this.state.allowlist.push(chatId);
      this.save();
    }
  }

  removeAllowed(chatId: string): void {
    this.state.allowlist = this.state.allowlist.filter(id => id !== chatId);
    this.save();
  }

  createPairingCode(chatId: string, length: number, ttlMs: number): { code: string; expiresAt: number } {
    this.pruneExpired();

    if (this.isAllowed(chatId)) {
      return { code: '', expiresAt: 0 };
    }

    const existing = this.findPendingByChatId(chatId);
    if (existing) {
      return { code: existing.code, expiresAt: existing.entry.expiresAt };
    }

    const code = this.generateCode(length);
    const now = Date.now();
    const entry: PairingEntry = {
      chatId,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    this.state.pending[code] = entry;
    this.save();

    return { code, expiresAt: entry.expiresAt };
  }

  approvePairing(code: string): string | null {
    this.pruneExpired();
    const entry = this.state.pending[code];
    if (!entry) {
      return null;
    }

    delete this.state.pending[code];
    this.addAllowed(entry.chatId);
    this.save();

    return entry.chatId;
  }

  private findPendingByChatId(chatId: string): { code: string; entry: PairingEntry } | null {
    const entry = Object.entries(this.state.pending).find(([, value]) => value.chatId === chatId);
    if (!entry) {
      return null;
    }
    return { code: entry[0], entry: entry[1] };
  }

  private pruneExpired(): void {
    const now = Date.now();
    let updated = false;

    Object.entries(this.state.pending).forEach(([code, entry]) => {
      if (entry.expiresAt <= now) {
        delete this.state.pending[code];
        updated = true;
      }
    });

    if (updated) {
      this.save();
    }
  }

  private generateCode(length: number): string {
    let code = '';
    for (let i = 0; i < length; i += 1) {
      code += Math.floor(Math.random() * 10).toString();
    }
    return code;
  }

  private load(): void {
    if (!existsSync(this.storeFile)) {
      this.save();
      return;
    }

    try {
      const content = readFileSync(this.storeFile, 'utf8');
      const parsed = JSON.parse(content) as PairingState;
      if (parsed && parsed.allowlist && parsed.pending) {
        this.state = parsed;
      }
    } catch (error) {
      console.warn('[TelegramPairingStore] Failed to load pairing store:', error);
      this.state = { allowlist: [], pending: {} };
      this.save();
    }
  }

  private save(): void {
    try {
      writeFileSync(this.storeFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      console.warn('[TelegramPairingStore] Failed to save pairing store:', error);
    }
  }
}
