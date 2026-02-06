import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { ToolManager } from '../../src/tools/tool-manager.js';

describe('Telegram tools', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(os.tmpdir(), `openclaw-lite-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'config', 'tool-config.json');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sends telegram messages via tools', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ ok: true })
    }) as unknown as typeof fetch);

    const manager = new ToolManager({
      workspacePath: tempDir,
      disableApprovals: true,
      requireApprovalForDangerous: true,
      configPath,
      telegramBotToken: 'token',
    });

    const send = await manager.callTool(
      'telegram_send',
      { chatId: '123', text: 'hello' },
      { sessionId: 'test' }
    );

    expect(send.success).toBe(true);

    const reply = await manager.callTool(
      'telegram_reply',
      { chatId: '123', messageId: 42, text: 'reply' },
      { sessionId: 'test' }
    );

    expect(reply.success).toBe(true);
  });
});
