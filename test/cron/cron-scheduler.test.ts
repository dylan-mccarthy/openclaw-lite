import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { CronStore } from '../../src/cron/cron-store.js';
import { CronScheduler } from '../../src/cron/cron-scheduler.js';

describe('CronScheduler', () => {
  let tempDir: string;

  afterEach(() => {
    vi.useRealTimers();
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs scheduled jobs and logs run events', async () => {
    tempDir = join(os.tmpdir(), `openclaw-lite-cron-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });

    const store = new CronStore(tempDir);
    const job = store.addJob({
      name: 'Test Job',
      schedule: '* * * * *',
      message: 'Ping',
      enabled: true,
    });

    const onRun = vi.fn(async () => {
      store.updateJob(job.id, { enabled: false });
    });
    const logger = { logEvent: vi.fn() };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const scheduler = new CronScheduler({ store, onRun, logger });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(logger.logEvent).toHaveBeenCalledWith('cron_run_start', expect.any(Object));
    expect(logger.logEvent).toHaveBeenCalledWith('cron_run_end', expect.any(Object));

    scheduler.stop();
  });
});
