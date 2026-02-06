import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { TelegramPairingStore } from '../../src/telegram/pairing-store.js';

describe('TelegramPairingStore', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('creates and approves pairing codes', () => {
    tempDir = join(os.tmpdir(), `openclaw-lite-telegram-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    const store = new TelegramPairingStore(tempDir);
    const { code } = store.createPairingCode('123', 6, 60_000);

    expect(code).toHaveLength(6);
    expect(store.listPending().length).toBe(1);

    const chatId = store.approvePairing(code);
    expect(chatId).toBe('123');
    expect(store.isAllowed('123')).toBe(true);
  });
});
