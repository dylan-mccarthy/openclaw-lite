import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { ToolManager } from '../../src/tools/tool-manager.js';

describe('ToolManager approvals', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(os.tmpdir(), `openclaw-lite-tools-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'config', 'tool-config.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('executes dangerous tool without approval when approvals are disabled', async () => {
    const manager = new ToolManager({
      workspacePath: tempDir,
      disableApprovals: true,
      requireApprovalForDangerous: true,
      configPath,
    });

    const writeResult = await manager.callTool(
      'write',
      { path: 'test.txt', content: 'hello' },
      { sessionId: 'test' }
    );

    expect(writeResult.success).toBe(true);

    const readResult = await manager.callTool(
      'read',
      { path: 'test.txt' },
      { sessionId: 'test' }
    );

    expect(readResult.success).toBe(true);
    expect(readResult.result).toContain('hello');
  });

  it('requires approval for dangerous tools when approvals are enabled', async () => {
    const manager = new ToolManager({
      workspacePath: tempDir,
      disableApprovals: false,
      requireApprovalForDangerous: true,
      configPath,
    });

    const result = await manager.callTool(
      'write',
      { path: 'blocked.txt', content: 'nope' },
      { sessionId: 'test' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Approval required/);
  });

  it('denies execution when approval handler returns false', async () => {
    const manager = new ToolManager({
      workspacePath: tempDir,
      disableApprovals: false,
      requireApprovalForDangerous: true,
      configPath,
    });

    const result = await manager.callTool(
      'write',
      { path: 'blocked.txt', content: 'nope' },
      {
        sessionId: 'test',
        requireApproval: async () => false,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not approved/i);
  });
});
