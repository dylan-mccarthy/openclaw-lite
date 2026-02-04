import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { FileLoader } from '../../src/identity/file-loader.js';
import { SecureKeyManager, getEncryptionKeyFromSecureStorage } from '../../src/security/secure-key-manager.js';
import { EncryptionManager } from '../../src/security/encryption-manager.js';

describe('File encryption', () => {
  let tempHome: string;
  let workspacePath: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tempHome = join(os.tmpdir(), `openclaw-lite-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workspacePath = join(tempHome, '.openclaw-lite', 'workspace');
    mkdirSync(workspacePath, { recursive: true });
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('encrypts sensitive files when secure storage is available', async () => {
    const keyManager = new SecureKeyManager();
    keyManager.initializeSecureStorage();

    const soulPath = join(workspacePath, 'SOUL.md');
    writeFileSync(soulPath, 'super-secret', 'utf8');

    const loader = new FileLoader(workspacePath);
    expect(loader.isEncryptionAvailable()).toBe(true);

    await loader.ensureEncryptedFiles();

    const key = getEncryptionKeyFromSecureStorage();
    expect(key).toBeTruthy();

    const encryption = new EncryptionManager(key as string);
    expect(encryption.isEncryptedFile(soulPath)).toBe(true);
  });

  it('reports encryption unavailable when secure storage is missing', () => {
    const loader = new FileLoader(workspacePath);
    expect(loader.isEncryptionAvailable()).toBe(false);
  });
});
