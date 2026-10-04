import type { ClaimOptions, JobQueue, JobStore } from "@/application/jobs/ports";
import type { Actor } from "@/domain/auth/authorization";
import { roleAtLeast } from "@/domain/auth/authorization";
import { assertJobTransition, type EnqueueJobInput, type Job, type JobStatus } from "@/domain/jobs/job";
import { RESEARCH_STAGE_JOB_TYPES } from "@/domain/jobs/research-jobs";
import { DomainError } from "@/domain/shared/errors";
import type { WorkerSnapshot } from "@/domain/ops/worker-health";
import type { Clock } from "@/lib/clock";
import { newId } from "@/lib/ids";
import type { MemoryDatabase } from "./memory-db";

/**
 * In-memory queue with the same semantics as the Postgres implementation
 * (supabase/migrations/20261004000100_job_queue.sql): idempotent enqueue,
 * exclusive leases, conditional writes, backoff scheduling, dead letters.
 * Used by tests and DEMO mode.
 */
function update(db: MemoryDatabase, job: Job, patch: Partial<Job>, clock: Clock): Job {
  if (patch.status && patch.status !== job.status) assertJobTransition(job.status, patch.status);
  const next = { ...job, ...patch, updatedAt: clock.now().toISOString() };
  db.jobs.set(job.id, next);
  return next;
}

function insert(db: MemoryDatabase, clock: Clock, organizationId: string, userId: string | null, input: EnqueueJobInput) {
  const existing = [...db.jobs.values()].find((j) => j.organizationId === organizationId && j.idempotencyKey === input.idempotencyKey);
  if (existing) return { job: existing, created: false };
  if (input.researchRunId) {
    const run = db.runs.get(input.researchRunId);
    if (!run || run.organizationId !== organizationId) throw new DomainError("FORBIDDEN", "research run not found");
  }
  if (input.opportunityId) {
    const opp = db.opportunities.get(input.opportunityId);
    if (!opp || opp.organizationId !== organizationId) throw new DomainError("FORBIDDEN", "opportunity not found");
  }
  const now = clock.now().toISOString();
  const job: Job = {
    id: newId(),
    organizationId,
    userId,
    researchRunId: input.researchRunId ?? null,
    opportunityId: input.opportunityId ?? null,
    jobType: input.jobType,
    payload: input.payload ?? {},
    status: "QUEUED",
    priority: Math.min(1000, Math.max(0, input.priority ?? 100)),
    attemptCount: 0,
    maxAttempts: Math.min(20, Math.max(1, input.maxAttempts ?? 5)),
    availableAt: input.availableAt ?? now,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    lastError: null,
    idempotencyKey: input.idempotencyKey,
    lockedBy: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    cancelRequested: false,
    deadLettered: false,
    result: null,
    createdAt: now,
    updatedAt: now,
  };
  db.jobs.set(job.id, job);
  return { job, created: true };
}

const TERMINAL_RUN = ["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"];

function closeRun(db: MemoryDatabase, clock: Clock, job: Job, status: "FAILED" | "CANCELLED", reason: string) {
  if (!job.researchRunId || !RESEARCH_STAGE_JOB_TYPES.includes(job.jobType)) return;
  const run = db.runs.get(job.researchRunId);
  if (!run || TERMINAL_RUN.includes(run.status)) return;
  db.runs.set(run.id, { ...run, status, statusReason: reason, progressPercent: 100, completedAt: clock.now().toISOString() });
}

export function createMemoryJobQueue(db: MemoryDatabase, actor: Actor, clock: Clock): JobQueue {
  const mine = (j: Job | undefined) => (j && j.organizationId === actor.organizationId ? j : null);
  return {
    async enqueue(input) {
      if (!roleAtLeast(actor.role, "member")) throw new DomainError("FORBIDDEN", "not allowed to enqueue jobs");
      return insert(db, clock, actor.organizationId, actor.userId, input);
    },
    async get(id) {
      return mine(db.jobs.get(id));
    },
    async list(filter = {}) {
      return [...db.jobs.values()]
        .filter(
          (j) =>
            j.organizationId === actor.organizationId &&
            (!filter.researchRunId || j.researchRunId === filter.researchRunId) &&
            (!filter.status || j.status === filter.status) &&
            (!filter.deadLetteredOnly || j.deadLettered),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, filter.limit ?? 50);
    },
    async cancel(id) {
      const j = mine(db.jobs.get(id));
      if (!j || !roleAtLeast(actor.role, "member")) throw new DomainError("NOT_FOUND", "job not found");
      if (j.status === "QUEUED" || j.status === "RETRYING") {
        const out = update(db, j, { status: "CANCELLED", completedAt: clock.now().toISOString() }, clock);
        closeRun(db, clock, out, "CANCELLED", "ユーザーがキャンセルしました");
        return out;
      }
      if (j.status === "PROCESSING") return update(db, j, { cancelRequested: true }, clock);
      return j;
    },
    async requeueDeadLetter(id) {
      const j = mine(db.jobs.get(id));
      if (!j || !roleAtLeast(actor.role, "admin")) throw new DomainError("NOT_FOUND", "job not found");
      if (j.status !== "FAILED") throw new DomainError("ILLEGAL_TRANSITION", "only failed jobs can be re-queued");
      return update(
        db,
        j,
        { status: "QUEUED", attemptCount: 0, deadLettered: false, failedAt: null, availableAt: clock.now().toISOString(), lockedBy: null, leaseExpiresAt: null, cancelRequested: false },
        clock,
      );
    },
  };
}

export class MemoryJobStore implements JobStore {
  readonly provider = "memory";

  constructor(
    private readonly db: MemoryDatabase,
    private readonly clock: Clock,
  ) {}

  private nowMs(): number {
    return this.clock.now().getTime();
  }

  private owned(jobId: string, workerId: string): Job | null {
    const j = this.db.jobs.get(jobId);
    return j && j.status === "PROCESSING" && j.lockedBy === workerId ? j : null;
  }

  async claim(workerId: string, options: ClaimOptions): Promise<Job[]> {
    const now = this.nowMs();
    const iso = new Date(now).toISOString();
    const leaseUntil = new Date(now + Math.min(3600, Math.max(10, options.leaseSeconds)) * 1000).toISOString();
    // Expired leases with no attempts left → dead letter (+ fail the run).
    for (const j of this.db.jobs.values()) {
      if (j.status === "PROCESSING" && j.leaseExpiresAt && Date.parse(j.leaseExpiresAt) < now && j.attemptCount >= j.maxAttempts) {
        const out = update(this.db, j, { status: "FAILED", deadLettered: true, failedAt: iso, lockedBy: null, leaseExpiresAt: null, lastError: `${j.lastError ? `${j.lastError} | ` : ""}lease expired after final attempt (worker lost)` }, this.clock);
        closeRun(this.db, this.clock, out, "FAILED", "バックグラウンド処理が応答しなくなったため停止しました（再試行上限）");
      }
    }
    const ready = [...this.db.jobs.values()]
      .filter(
        (j) =>
          ((j.status === "QUEUED" || j.status === "RETRYING") && Date.parse(j.availableAt) <= now) ||
          (j.status === "PROCESSING" && j.leaseExpiresAt !== null && Date.parse(j.leaseExpiresAt) < now),
      )
      .filter((j) => !options.jobTypes || options.jobTypes.includes(j.jobType))
      .sort((a, b) => a.priority - b.priority || a.availableAt.localeCompare(b.availableAt) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.min(50, Math.max(1, options.limit)));
    return ready.map((j) =>
      update(
        this.db,
        j,
        { status: "PROCESSING", lockedBy: workerId, attemptCount: j.attemptCount + 1, startedAt: j.startedAt ?? iso, heartbeatAt: iso, leaseExpiresAt: leaseUntil },
        this.clock,
      ),
    );
  }

  async heartbeat(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean> {
    const j = this.owned(jobId, workerId);
    if (!j || j.cancelRequested) return false;
    const now = this.nowMs();
    update(this.db, j, { heartbeatAt: new Date(now).toISOString(), leaseExpiresAt: new Date(now + leaseSeconds * 1000).toISOString() }, this.clock);
    return true;
  }

  async complete(jobId: string, workerId: string, result?: Record<string, unknown>): Promise<boolean> {
    const j = this.owned(jobId, workerId);
    if (!j) return false;
    update(this.db, j, { status: "COMPLETED", completedAt: this.clock.now().toISOString(), result: result ?? null, lockedBy: null, leaseExpiresAt: null, lastError: null }, this.clock);
    return true;
  }

  async fail(jobId: string, workerId: string, error: string, retryable: boolean, retryDelaySeconds: number): Promise<Job | null> {
    const j = this.owned(jobId, workerId);
    if (!j) return null;
    const iso = this.clock.now().toISOString();
    const lastError = error.slice(0, 2000);
    if (j.cancelRequested) return update(this.db, j, { status: "CANCELLED", completedAt: iso, lockedBy: null, leaseExpiresAt: null, lastError }, this.clock);
    if (retryable && j.attemptCount < j.maxAttempts) {
      const delay = Math.min(3600, Math.max(1, retryDelaySeconds));
      return update(this.db, j, { status: "RETRYING", lockedBy: null, leaseExpiresAt: null, lastError, availableAt: new Date(this.nowMs() + delay * 1000).toISOString() }, this.clock);
    }
    return update(this.db, j, { status: "FAILED", deadLettered: true, failedAt: iso, lockedBy: null, leaseExpiresAt: null, lastError }, this.clock);
  }

  async release(jobId: string, workerId: string): Promise<boolean> {
    const j = this.owned(jobId, workerId);
    if (!j) return false;
    update(this.db, j, { status: "RETRYING", lockedBy: null, leaseExpiresAt: null, availableAt: this.clock.now().toISOString(), attemptCount: Math.max(0, j.attemptCount - 1) }, this.clock);
    return true;
  }

  async enqueueFor(organizationId: string, userId: string | null, input: EnqueueJobInput) {
    return insert(this.db, this.clock, organizationId, userId, input);
  }

  async reportWorker(s: WorkerSnapshot & { currentJobId: string | null }) {
    this.db.workers.set(s.workerId, s);
  }

  async stats() {
    const groups = new Map<JobStatus, { count: number; oldest: string | null }>();
    for (const j of this.db.jobs.values()) {
      const g = groups.get(j.status) ?? { count: 0, oldest: null };
      g.count++;
      if (!g.oldest || j.createdAt < g.oldest) g.oldest = j.createdAt;
      groups.set(j.status, g);
    }
    return [...groups.entries()].map(([status, g]) => ({ status, ...g }));
  }
}
