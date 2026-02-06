import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { CronStore } from '../../src/cron/cron-store.js';

describe('CronStore', () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('adds, updates, and deletes jobs', () => {
    tempDir = join(os.tmpdir(), `openclaw-lite-cron-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    const store = new CronStore(tempDir);
    const job = store.addJob({
      name: 'Test Job',
      schedule: '* * * * *',
      message: 'Ping',
      enabled: true,
    });

    expect(job.id).toBeTruthy();
    expect(store.listJobs().length).toBe(1);

    const updated = store.updateJob(job.id, { enabled: false });
    expect(updated?.enabled).toBe(false);

    const deleted = store.deleteJob(job.id);
    expect(deleted).toBe(true);
  });
});
