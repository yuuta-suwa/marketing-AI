import type { AppContext } from "@/application/context";
import { backoffSeconds, isRetryableError, JobError, type EnqueueJobInput, type Job, type JobType } from "@/domain/jobs/job";
import type { Logger } from "@/lib/logger";
import type { WorkerSnapshot } from "@/domain/ops/worker-health";
import type { JobStore } from "./ports";

export type JobHandlerArgs = {
  job: Job;
  ctx: AppContext;
  /** Renews the lease; throws JobLostError when the job was lost or cancelled. */
  checkpoint: () => Promise<void>;
  /** Enqueue follow-up work for the same organization/user (idempotent). */
  enqueue: (input: EnqueueJobInput) => Promise<Job>;
  logger: Logger;
};

export type JobHandler = (args: JobHandlerArgs) => Promise<Record<string, unknown> | void>;

export type JobHandlers = Partial<Record<JobType, JobHandler>> & {
  /** Called once when a job is permanently failed (dead letter) — e.g. mark the run FAILED. */
  onDeadLetter?: (job: Job, ctx: AppContext | null, error: string) => Promise<void>;
  /** Called when a processing job ends CANCELLED. */
  onCancelled?: (job: Job, ctx: AppContext | null) => Promise<void>;
};

export type WorkerOptions = {
  workerId: string;
  leaseSeconds: number;
  /** How often the lease is renewed while a handler runs. */
  heartbeatMs: number;
  /** Max jobs claimed per poll. Each runs sequentially (bounded resource use). */
  batchSize: number;
  jobTypes?: readonly JobType[];
  /** Release identifier published in worker health. */
  version?: string;
  appEnv?: string;
  /** Credential statuses (names → CONFIGURED/MISSING/…); never values. */
  diagnostics?: () => Record<string, string>;
  backoff?: { baseSeconds: number; maxSeconds: number; random?: () => number };
};

/** Thrown inside a handler when the worker no longer owns the job. */
export class JobLostError extends JobError {
  constructor(message = "lease lost or cancellation requested") {
    super(message, false);
    this.name = "JobLostError";
  }
}

/**
 * Provider-agnostic job worker. Runs anywhere Node runs (container, VM,
 * Supabase-adjacent service, or a bounded cron-triggered drain). It is NOT
 * tied to a frontend request lifecycle.
 *
 * Guarantees:
 *   * leasing: a job is executed by at most one live worker (claim = FOR UPDATE
 *     SKIP LOCKED; every write is conditional on owning the lease);
 *   * heartbeat: the lease is renewed while the handler runs; losing it aborts
 *     the handler at its next checkpoint without touching the job row;
 *   * retries: retryable errors are re-scheduled with exponential backoff and
 *     jitter until max_attempts; then (or for non-retryable errors) the job is
 *     dead-lettered and onDeadLetter runs;
 *   * recovery: a crashed worker's jobs are re-claimed after their lease expires;
 *   * idempotency: handlers must be idempotent (research stages are — see
 *     runResearchStage), so a re-delivered job never duplicates business data.
 */
export class JobWorker {
  private stopping = false;
  private current: Job | null = null;
  private wake: (() => void) | null = null;
  private readonly startedAt = new Date();
  private processedCount = 0;
  private failedCount = 0;
  private lastPublished = 0;

  constructor(
    private readonly deps: {
      store: JobStore;
      handlers: JobHandlers;
      /** Builds a tenant-scoped context for the job's owner; throws if they lost access. */
      contextFor: (job: Job) => Promise<AppContext>;
      logger: Logger;
      options: WorkerOptions;
    },
  ) {}

  get busy(): boolean {
    return this.current !== null;
  }

  /** Liveness snapshot (worker_heartbeats row / /healthz). */
  snapshot(): WorkerSnapshot & { currentJobId: string | null } {
    const o = this.deps.options;
    return {
      workerId: o.workerId,
      startedAt: this.startedAt.toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
      jobsProcessed: this.processedCount,
      jobsFailed: this.failedCount,
      currentJobId: this.current?.id ?? null,
      currentJobType: this.current?.jobType ?? null,
      busy: this.current !== null,
      version: o.version ?? "dev",
      appEnv: o.appEnv ?? "local",
      diagnostics: o.diagnostics?.() ?? {},
    };
  }

  /** Publishes liveness; failures are logged, never fatal. */
  async publishHealth(force = false): Promise<void> {
    if (!force && Date.now() - this.lastPublished < this.deps.options.heartbeatMs) return;
    this.lastPublished = Date.now();
    try {
      await this.deps.store.reportWorker(this.snapshot());
    } catch (e) {
      this.deps.logger.warn("worker.health_publish_failed", { error: (e as Error).message });
    }
  }

  /** Claims and processes up to batchSize jobs. Returns how many were processed. */
  async runOnce(): Promise<number> {
    const { store, options, logger } = this.deps;
    const jobs = await store.claim(options.workerId, { limit: options.batchSize, leaseSeconds: options.leaseSeconds, jobTypes: options.jobTypes });
    for (const job of jobs) {
      if (this.stopping) {
        await store.release(job.id, options.workerId);
        logger.info("job.released_on_shutdown", { job_id: job.id, job_type: job.jobType });
        continue;
      }
      await this.process(job);
    }
    return jobs.length;
  }

  /** Processes until the queue is empty (or maxJobs). Used by drains and tests. */
  async drain(maxJobs = 1000): Promise<number> {
    let total = 0;
    while (!this.stopping && total < maxJobs) {
      const n = await this.runOnce();
      if (n === 0) break;
      total += n;
    }
    return total;
  }

  /** Long-running loop with idle polling. Resolves after stop(). */
  async runLoop(options: { idleMs: number; signal?: AbortSignal }): Promise<void> {
    const { logger } = this.deps;
    options.signal?.addEventListener("abort", () => this.stop());
    logger.info("worker.started", { worker_id: this.deps.options.workerId, provider: this.deps.store.provider });
    let consecutiveErrors = 0;
    await this.publishHealth(true);
    while (!this.stopping) {
      await this.publishHealth();
      let processed = 0;
      try {
        processed = await this.runOnce();
        consecutiveErrors = 0;
      } catch (e) {
        consecutiveErrors++;
        logger.error("worker.poll_failed", { error: (e as Error).message, retry_count: consecutiveErrors });
      }
      if (processed === 0 && !this.stopping) {
        // Back off on repeated infrastructure errors, poll normally otherwise.
        const wait = consecutiveErrors > 0 ? Math.min(60_000, options.idleMs * 2 ** consecutiveErrors) : options.idleMs;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, wait);
          this.wake = () => {
            clearTimeout(t);
            resolve();
          };
        });
        this.wake = null;
      }
    }
    await this.publishHealth(true);
    logger.info("worker.stopped", { worker_id: this.deps.options.workerId, jobs_processed: this.processedCount, jobs_failed: this.failedCount });
  }

  /** Graceful shutdown: finish nothing new; the running job ends at its next checkpoint or completes. */
  stop(): void {
    this.stopping = true;
    this.wake?.();
  }

  private async process(job: Job): Promise<void> {
    const { store, handlers, options } = this.deps;
    const log = this.deps.logger.child({
      job_id: job.id,
      job_type: job.jobType,
      organization_id: job.organizationId,
      research_run_id: job.researchRunId ?? undefined,
      attempt: job.attemptCount,
      worker_id: options.workerId,
    });
    this.current = job;
    await this.publishHealth(true);
    const started = Date.now();
    let failed = false;
    let lost = false;
    let ctx: AppContext | null = null;

    const beat = async () => {
      try {
        const ok = await store.heartbeat(job.id, options.workerId, options.leaseSeconds);
        if (!ok) lost = true;
      } catch (e) {
        // Transient DB error: keep working; the lease is long enough to survive a missed beat.
        log.warn("job.heartbeat_failed", { error: (e as Error).message });
      }
    };
    const timer = setInterval(() => void beat(), options.heartbeatMs);
    // Checkpoints sit between units of work (a few per stage): renew the lease
    // and observe cancellation/ownership immediately rather than on the timer.
    const checkpoint = async () => {
      await beat();
      if (lost) throw new JobLostError();
    };

    try {
      log.info("job.started");
      const handler = handlers[job.jobType];
      if (!handler) throw new JobError(`no handler registered for ${job.jobType}`, false);
      ctx = await this.deps.contextFor(job);
      const result = await handler({
        job,
        ctx,
        checkpoint,
        logger: log,
        enqueue: async (input) => (await store.enqueueFor(job.organizationId, job.userId, input)).job,
      });
      if (lost) throw new JobLostError();
      const ok = await store.complete(job.id, options.workerId, result ?? undefined);
      log.info(ok ? "job.completed" : "job.complete_ignored_lost_lease", { status: "COMPLETED", duration_ms: Date.now() - started });
    } catch (e) {
      failed = true;
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof JobLostError || lost) {
        // Either another worker owns it now (no-op) or a cancel was requested (→ CANCELLED).
        const after = await store.fail(job.id, options.workerId, message, true, 1).catch(() => null);
        if (after?.status === "CANCELLED") {
          log.warn("job.cancelled", { status: "CANCELLED" });
          await handlers.onCancelled?.(after, ctx).catch((err) => log.error("job.on_cancelled_failed", { error: (err as Error).message }));
        } else {
          log.warn("job.lease_lost", { status: after?.status ?? "LOST", duration_ms: Date.now() - started });
        }
        return;
      }
      const retryable = isRetryableError(e);
      const delay = backoffSeconds(job.attemptCount, options.backoff);
      const after = await store.fail(job.id, options.workerId, message, retryable, delay);
      if (after?.deadLettered) {
        log.error("job.dead_lettered", { error: message, status: "FAILED", retry_count: job.attemptCount, duration_ms: Date.now() - started });
        await handlers.onDeadLetter?.(after, ctx, message).catch((err) => log.error("job.on_dead_letter_failed", { error: (err as Error).message }));
      } else if (after?.status === "CANCELLED") {
        log.warn("job.cancelled", { status: "CANCELLED" });
        await handlers.onCancelled?.(after, ctx).catch((err) => log.error("job.on_cancelled_failed", { error: (err as Error).message }));
      } else {
        log.warn("job.retry_scheduled", { error: message, status: after?.status ?? "LOST", retry_in_s: delay, retry_count: job.attemptCount });
      }
    } finally {
      clearInterval(timer);
      this.processedCount++;
      if (failed) this.failedCount++;
      this.current = null;
      await this.publishHealth(true);
    }
  }
}
