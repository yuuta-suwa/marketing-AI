import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClaimOptions, JobQueue, JobStore } from "@/application/jobs/ports";
import type { Actor } from "@/domain/auth/authorization";
import type { EnqueueJobInput, Job, JobStatus, JobType } from "@/domain/jobs/job";
import { DomainError } from "@/domain/shared/errors";
import type { WorkerSnapshot } from "@/domain/ops/worker-health";

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come from PostgREST untyped */
type Row = Record<string, any>;

export const mapJob = (r: Row): Job => ({
  id: r.id,
  organizationId: r.organization_id,
  userId: r.user_id ?? null,
  researchRunId: r.research_run_id ?? null,
  opportunityId: r.opportunity_id ?? null,
  jobType: r.job_type as JobType,
  payload: r.payload ?? {},
  status: r.status as JobStatus,
  priority: r.priority,
  attemptCount: r.attempt_count,
  maxAttempts: r.max_attempts,
  availableAt: r.available_at,
  startedAt: r.started_at ?? null,
  completedAt: r.completed_at ?? null,
  failedAt: r.failed_at ?? null,
  lastError: r.last_error ?? null,
  idempotencyKey: r.idempotency_key,
  lockedBy: r.locked_by ?? null,
  leaseExpiresAt: r.lease_expires_at ?? null,
  heartbeatAt: r.heartbeat_at ?? null,
  cancelRequested: Boolean(r.cancel_requested),
  deadLettered: Boolean(r.dead_lettered),
  result: r.result ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function check<T>(res: { data: T | null; error: { message: string; code?: string } | null }, what: string): T | null {
  if (res.error) {
    if (res.error.code === "42501") throw new DomainError("FORBIDDEN", `${what}: ${res.error.message}`);
    if (res.error.code === "23514") throw new DomainError("ILLEGAL_TRANSITION", `${what}: ${res.error.message}`);
    throw new Error(`${what}: ${res.error.message}`);
  }
  return res.data;
}

/** Columns users may read (payload excluded from lists: it may hold pasted text). */
const LIST_COLUMNS =
  "id, organization_id, user_id, research_run_id, opportunity_id, job_type, status, priority, attempt_count, max_attempts, available_at, started_at, completed_at, failed_at, last_error, idempotency_key, locked_by, lease_expires_at, heartbeat_at, cancel_requested, dead_lettered, result, created_at, updated_at";

/**
 * User-scoped queue. Writes go through SECURITY DEFINER functions that check
 * membership/role and that referenced runs/opportunities belong to the org.
 */
export function createSupabaseJobQueue(db: SupabaseClient, actor: Actor): JobQueue {
  const org = actor.organizationId;
  return {
    async enqueue(input) {
      const res = await db.rpc("enqueue_job", {
        org,
        job_type: input.jobType,
        idempotency_key: input.idempotencyKey,
        payload: input.payload ?? {},
        research_run_id: input.researchRunId ?? null,
        opportunity_id: input.opportunityId ?? null,
        priority: input.priority ?? 100,
        max_attempts: input.maxAttempts ?? 5,
        available_at: input.availableAt ?? null,
      });
      const out = check(res, "enqueue job") as { job: Row; created: boolean };
      return { job: mapJob({ ...out.job, payload: {} }), created: out.created === true };
    },
    async get(id) {
      const res = await db.from("jobs").select(LIST_COLUMNS).eq("organization_id", org).eq("id", id).maybeSingle();
      const row = check(res, "get job") as Row | null;
      return row ? mapJob({ ...row, payload: {} }) : null;
    },
    async list(filter = {}) {
      let q = db.from("jobs").select(LIST_COLUMNS).eq("organization_id", org).order("created_at", { ascending: false }).limit(filter.limit ?? 50);
      if (filter.researchRunId) q = q.eq("research_run_id", filter.researchRunId);
      if (filter.status) q = q.eq("status", filter.status);
      if (filter.deadLetteredOnly) q = q.eq("dead_lettered", true);
      return ((check(await q, "list jobs") as Row[] | null) ?? []).map((r) => mapJob({ ...r, payload: {} }));
    },
    async cancel(id) {
      const row = check(await db.rpc("cancel_job", { job_id: id }), "cancel job") as Row | null;
      return row?.id ? mapJob(row) : null;
    },
    async requeueDeadLetter(id) {
      return mapJob(check(await db.rpc("requeue_dead_letter", { job_id: id }), "requeue job") as Row);
    },
  };
}

/**
 * Worker store over the service-role client. Only the worker process holds
 * these credentials; it is never constructed in a user request path.
 */
export class SupabaseJobStore implements JobStore {
  readonly provider = "postgres";

  constructor(private readonly admin: SupabaseClient) {}

  async claim(workerId: string, options: ClaimOptions): Promise<Job[]> {
    const res = await this.admin.rpc("claim_jobs", {
      worker_id: workerId,
      max_jobs: options.limit,
      lease_seconds: options.leaseSeconds,
      job_types: options.jobTypes ? [...options.jobTypes] : null,
    });
    return ((check(res, "claim jobs") as Row[] | null) ?? []).map(mapJob);
  }

  async heartbeat(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean> {
    return check(await this.admin.rpc("heartbeat_job", { job_id: jobId, worker_id: workerId, lease_seconds: leaseSeconds }), "heartbeat") === true;
  }

  async complete(jobId: string, workerId: string, result?: Record<string, unknown>): Promise<boolean> {
    return check(await this.admin.rpc("complete_job", { job_id: jobId, worker_id: workerId, job_result: result ?? null }), "complete job") === true;
  }

  async fail(jobId: string, workerId: string, error: string, retryable: boolean, retryDelaySeconds: number): Promise<Job | null> {
    const row = check(
      await this.admin.rpc("fail_job", { job_id: jobId, worker_id: workerId, error, retryable, retry_delay_seconds: Math.round(retryDelaySeconds) }),
      "fail job",
    ) as Row | null;
    return row?.id ? mapJob(row) : null;
  }

  async release(jobId: string, workerId: string): Promise<boolean> {
    return check(await this.admin.rpc("release_job", { job_id: jobId, worker_id: workerId }), "release job") === true;
  }

  async enqueueFor(organizationId: string, userId: string | null, input: EnqueueJobInput) {
    const insert = await this.admin
      .from("jobs")
      .upsert(
        {
          organization_id: organizationId,
          user_id: userId,
          research_run_id: input.researchRunId ?? null,
          opportunity_id: input.opportunityId ?? null,
          job_type: input.jobType,
          payload: input.payload ?? {},
          priority: input.priority ?? 100,
          max_attempts: input.maxAttempts ?? 5,
          available_at: input.availableAt ?? new Date().toISOString(),
          idempotency_key: input.idempotencyKey,
        },
        { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true },
      )
      .select();
    const created = ((check(insert, "enqueue (system)") as Row[] | null) ?? [])[0];
    if (created) return { job: mapJob(created), created: true };
    const existing = check(
      await this.admin.from("jobs").select().eq("organization_id", organizationId).eq("idempotency_key", input.idempotencyKey).single(),
      "find job",
    ) as Row;
    return { job: mapJob(existing), created: false };
  }

  async reportWorker(s: WorkerSnapshot & { currentJobId: string | null }) {
    const res = await this.admin.from("worker_heartbeats").upsert({
      worker_id: s.workerId,
      started_at: s.startedAt,
      last_heartbeat_at: s.lastHeartbeatAt,
      jobs_processed: s.jobsProcessed,
      jobs_failed: s.jobsFailed,
      current_job_id: s.currentJobId,
      current_job_type: s.currentJobType,
      version: s.version,
      app_env: s.appEnv,
      diagnostics: s.diagnostics,
    });
    check(res, "worker heartbeat");
  }

  async stats() {
    const rows = (check(await this.admin.rpc("job_queue_stats"), "queue stats") as Row[] | null) ?? [];
    return rows.map((r) => ({ status: r.status as JobStatus, count: Number(r.job_count), oldest: r.oldest ?? null }));
  }
}
