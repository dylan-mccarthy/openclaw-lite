import { parseExpression } from 'cron-parser';
import type { CronJob, CronRun } from './cron-store.js';
import { CronStore } from './cron-store.js';
import type { DeepLogger } from '../logging/deep-logger.js';

export interface CronSchedulerOptions {
  store: CronStore;
  onRun: (job: CronJob) => Promise<void>;
  logger?: DeepLogger;
}

export class CronScheduler {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private options: CronSchedulerOptions) {}

  start(): void {
    const jobs = this.options.store.listJobs();
    jobs.forEach(job => {
      if (job.enabled) {
        this.schedule(job);
      }
    });
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  reschedule(job: CronJob): void {
    this.clear(job.id);
    if (job.enabled) {
      this.schedule(job);
    }
  }

  async triggerNow(job: CronJob): Promise<void> {
    await this.runJob(job);
  }

  private schedule(job: CronJob): void {
    let nextRunAt: number | null = null;

    try {
      const interval = parseExpression(job.schedule, { utc: true });
      nextRunAt = interval.next().getTime();
    } catch (error) {
      console.warn(`[Cron] Invalid schedule for ${job.id}:`, error);
      this.options.store.updateJob(job.id, { nextRunAt: undefined });
      return;
    }

    if (!nextRunAt) {
      return;
    }

    const delay = Math.max(0, nextRunAt - Date.now());
    this.options.store.updateJob(job.id, { nextRunAt });

    const timer = setTimeout(() => {
      this.runJob(job).catch(error => {
        console.warn(`[Cron] Job ${job.id} failed:`, error);
      });
    }, delay);

    this.timers.set(job.id, timer);
  }

  private async runJob(job: CronJob): Promise<void> {
    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const startedAt = Date.now();
    const run: CronRun = {
      id: runId,
      jobId: job.id,
      startedAt,
      status: 'running',
    };

    this.options.store.recordRun(run);

    this.options.logger?.logEvent('cron_run_start', {
      runId,
      jobId: job.id,
      schedule: job.schedule,
      sessionId: job.sessionId || 'main',
      messageLength: job.message.length,
    });

    try {
      await this.options.onRun(job);
      const endedAt = Date.now();
      this.options.store.updateRun(runId, { status: 'completed', endedAt });
      this.options.store.updateJob(job.id, { lastRunAt: endedAt });
      this.options.logger?.logEvent('cron_run_end', {
        runId,
        jobId: job.id,
        status: 'completed',
        durationMs: endedAt - startedAt,
      });
    } catch (error) {
      const endedAt = Date.now();
      this.options.store.updateRun(runId, {
        status: 'error',
        endedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      this.options.logger?.logEvent('cron_run_end', {
        runId,
        jobId: job.id,
        status: 'error',
        durationMs: endedAt - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      const refreshed = this.options.store.getJob(job.id);
      if (refreshed && refreshed.enabled) {
        this.schedule(refreshed);
      }
    }
  }

  private clear(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(jobId);
    }
  }
}
