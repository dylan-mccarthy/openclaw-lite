import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  message: string;
  sessionId?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface CronRun {
  id: string;
  jobId: string;
  startedAt: number;
  endedAt?: number;
  status: 'running' | 'completed' | 'error';
  error?: string;
}

interface CronStoreState {
  jobs: Record<string, CronJob>;
  runs: CronRun[];
}

export class CronStore {
  private storeFile: string;
  private state: CronStoreState = { jobs: {}, runs: [] };

  constructor(storagePath: string) {
    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
    }

    this.storeFile = path.join(storagePath, 'cron-jobs.json');
    this.load();
  }

  listJobs(): CronJob[] {
    return Object.values(this.state.jobs).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getJob(jobId: string): CronJob | undefined {
    return this.state.jobs[jobId];
  }

  addJob(job: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt'>): CronJob {
    const now = Date.now();
    const id = `cron_${now}_${Math.random().toString(36).substring(2, 8)}`;
    const record: CronJob = {
      ...job,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.state.jobs[id] = record;
    this.save();

    return record;
  }

  updateJob(jobId: string, updates: Partial<CronJob>): CronJob | undefined {
    const existing = this.state.jobs[jobId];
    if (!existing) {
      return undefined;
    }

    const record: CronJob = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    this.state.jobs[jobId] = record;
    this.save();

    return record;
  }

  deleteJob(jobId: string): boolean {
    if (!this.state.jobs[jobId]) {
      return false;
    }

    delete this.state.jobs[jobId];
    this.save();
    return true;
  }

  recordRun(run: CronRun): void {
    this.state.runs.push(run);
    this.save();
  }

  updateRun(runId: string, updates: Partial<CronRun>): void {
    const index = this.state.runs.findIndex(run => run.id === runId);
    if (index === -1) {
      return;
    }

    this.state.runs[index] = { ...this.state.runs[index], ...updates };
    this.save();
  }

  listRuns(jobId?: string, limit = 50): CronRun[] {
    const runs = jobId ? this.state.runs.filter(run => run.jobId === jobId) : this.state.runs;
    return runs.slice(-limit).reverse();
  }

  private load(): void {
    if (!existsSync(this.storeFile)) {
      this.save();
      return;
    }

    try {
      const content = readFileSync(this.storeFile, 'utf8');
      const parsed = JSON.parse(content) as CronStoreState;
      if (parsed && parsed.jobs && parsed.runs) {
        this.state = parsed;
      }
    } catch (error) {
      this.state = { jobs: {}, runs: [] };
      this.save();
    }
  }

  private save(): void {
    try {
      writeFileSync(this.storeFile, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error) {
      // Ignore save errors
    }
  }
}
