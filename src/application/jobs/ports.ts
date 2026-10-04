import type { EnqueueJobInput, Job, JobStatus } from "@/domain/jobs/job";
import type { WorkerSnapshot } from "@/domain/ops/worker-health";

/**
 * Queue port used by user requests (frontend / server actions). Bound to the
 * signed-in actor's organization; enqueue is idempotent per idempotencyKey.
 * The frontend ONLY enqueues — it never executes long-running work.
 */
export interface JobQueue {
  enqueue(input: EnqueueJobInput): Promise<{ job: Job; created: boolean }>;
  get(id: string): Promise<Job | null>;
  list(filter?: { researchRunId?: string; status?: JobStatus; deadLetteredOnly?: boolean; limit?: number }): Promise<Job[]>;
  /** Queued jobs are cancelled immediately; processing jobs stop at their next heartbeat. */
  cancel(id: string): Promise<Job | null>;
  /** Admin: give a dead-lettered job a fresh set of attempts. */
  requeueDeadLetter(id: string): Promise<Job>;
}

export type ClaimOptions = { limit: number; leaseSeconds: number; jobTypes?: readonly string[] };

/**
 * Worker-side port (system credentials, cross-tenant by design). Every
 * mutating call is conditional on the caller still owning the job's lease,
 * so a worker that lost its lease can never complete or fail someone
 * else's attempt. Implementations: Postgres (Supabase) and in-memory.
 */
export interface JobStore {
  readonly provider: string;
  claim(workerId: string, options: ClaimOptions): Promise<Job[]>;
  /** False when the lease was lost or cancellation was requested. */
  heartbeat(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean>;
  complete(jobId: string, workerId: string, result?: Record<string, unknown>): Promise<boolean>;
  /** Null when the worker no longer owns the job. */
  fail(jobId: string, workerId: string, error: string, retryable: boolean, retryDelaySeconds: number): Promise<Job | null>;
  /** Graceful shutdown: return the job to the queue without consuming an attempt. */
  release(jobId: string, workerId: string): Promise<boolean>;
  /** Enqueue on behalf of a job's owner (stage chaining). Idempotent. */
  enqueueFor(organizationId: string, userId: string | null, input: EnqueueJobInput): Promise<{ job: Job; created: boolean }>;
  stats(): Promise<Array<{ status: JobStatus; count: number; oldest: string | null }>>;
  /** Publishes this worker's liveness (worker_heartbeats). Best effort. */
  reportWorker(snapshot: WorkerSnapshot & { currentJobId: string | null }): Promise<void>;
}
