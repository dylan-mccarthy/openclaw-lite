import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { DeepLogger } from '../../src/logging/deep-logger.js';

describe('DeepLogger', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('writes JSONL entries and exports bundles', () => {
    tempDir = join(os.tmpdir(), `openclaw-lite-logs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    const logger = new DeepLogger(tempDir);
    logger.logEvent('test_event', { value: 42 });
    logger.logEvent('test_event', { value: 43 });

    const entries = logger.readRecent(10);
    expect(entries.length).toBe(2);
    expect(entries[0].type).toBe('test_event');

    const bundle = logger.exportBundle(10);
    expect(bundle.app.name).toBeDefined();
    expect(bundle.app.version).toBeDefined();
    expect(bundle.entries.length).toBe(2);
  });
});
