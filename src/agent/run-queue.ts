export type RunStatus = 'queued' | 'running' | 'completed' | 'error' | 'aborted' | 'timeout';

export interface RunMetadata {
  runId: string;
  sessionId: string;
  status: RunStatus;
  queuedAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export class RunQueue {
  private sessionQueues = new Map<string, Promise<unknown>>();
  private runs = new Map<string, RunMetadata>();

  createRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  getRun(runId: string): RunMetadata | undefined {
    return this.runs.get(runId);
  }

  listRuns(sessionId?: string): RunMetadata[] {
    const runs = Array.from(this.runs.values());
    return sessionId ? runs.filter(run => run.sessionId === sessionId) : runs;
  }

  markRun(runId: string, updates: Partial<RunMetadata>): void {
    const existing = this.runs.get(runId);
    if (!existing) {
      return;
    }
    this.runs.set(runId, { ...existing, ...updates });
  }

  async enqueue<T>(
    sessionId: string,
    runner: (meta: RunMetadata) => Promise<T>,
    runId?: string
  ): Promise<{ meta: RunMetadata; result: T }> {
    const resolvedRunId = runId || this.createRunId();
    const meta: RunMetadata = {
      runId: resolvedRunId,
      sessionId,
      status: 'queued',
      queuedAt: Date.now(),
    };

    this.runs.set(resolvedRunId, meta);

    const previous = this.sessionQueues.get(sessionId) || Promise.resolve();

    const runPromise = previous
      .catch(() => undefined)
      .then(async () => {
        meta.status = 'running';
        meta.startedAt = Date.now();
        this.runs.set(resolvedRunId, meta);

        const result = await runner(meta);

        meta.status = meta.status === 'running' ? 'completed' : meta.status;
        meta.endedAt = Date.now();
        this.runs.set(resolvedRunId, meta);

        return result;
      })
      .catch((error) => {
        if (meta.status === 'running') {
          meta.status = 'error';
        }
        meta.endedAt = Date.now();
        meta.error = error instanceof Error ? error.message : String(error);
        this.runs.set(resolvedRunId, meta);
        throw error;
      })
      .finally(() => {
        if (this.sessionQueues.get(sessionId) === runPromise) {
          this.sessionQueues.delete(sessionId);
        }
      });

    this.sessionQueues.set(sessionId, runPromise);
    const result = await runPromise;

    return { meta, result };
  }
}
