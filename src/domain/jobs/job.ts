import { DomainError } from "../shared/errors";

/** Units of background work. Research stages are chained jobs (one stage each). */
export const JOB_TYPES = [
  "RESEARCH_COLLECTION",
  "SIGNAL_EXTRACTION",
  "CLUSTER_GENERATION",
  "OPPORTUNITY_GENERATION",
  "DEEP_RESEARCH",
  "COMPETITOR_RESEARCH",
  "MARKET_SIZE_RESEARCH",
  "RED_TEAM",
  "DAILY_BRIEF",
  "WATCHLIST_REFRESH",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "RETRYING", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type Job = {
  id: string;
  organizationId: string;
  userId: string | null;
  researchRunId: string | null;
  opportunityId: string | null;
  jobType: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastError: string | null;
  idempotencyKey: string;
  lockedBy: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  cancelRequested: boolean;
  deadLettered: boolean;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type EnqueueJobInput = {
  jobType: JobType;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  researchRunId?: string;
  opportunityId?: string;
  priority?: number;
  maxAttempts?: number;
  availableAt?: string;
};

/**
 * MUST stay identical to private.job_transition_allowed() in SQL
 * (tests/unit/jobs.test.ts parses the migration to check parity).
 */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  QUEUED: ["PROCESSING", "CANCELLED"],
  RETRYING: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED", "FAILED", "RETRYING", "CANCELLED"],
  FAILED: ["QUEUED"],
  COMPLETED: [],
  CANCELLED: [],
};
const SELF_ALLOWED: ReadonlySet<JobStatus> = new Set(["PROCESSING", "QUEUED", "RETRYING"]);

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return SELF_ALLOWED.has(from);
  return TRANSITIONS[from].includes(to);
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJob(from, to)) throw new DomainError("ILLEGAL_TRANSITION", `Illegal job transition ${from} -> ${to}`);
}

export function isTerminalJobStatus(s: JobStatus): boolean {
  return s === "COMPLETED" || s === "CANCELLED" || s === "FAILED";
}

/**
 * Exponential backoff with full jitter, capped. attempt is 1-based (the
 * attempt that just failed). random is injectable for deterministic tests.
 */
export function backoffSeconds(attempt: number, options: { baseSeconds?: number; maxSeconds?: number; random?: () => number } = {}): number {
  const base = options.baseSeconds ?? 15;
  const max = options.maxSeconds ?? 900;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jitter = (options.random ?? Math.random)();
  // Half fixed + half jitter: never retries immediately, never exceeds the cap.
  return Math.max(1, Math.round(ceiling / 2 + (ceiling / 2) * jitter));
}

/** Errors a job handler can throw to control retry behaviour. */
export class JobError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "JobError";
  }
}

/** True when a failure is worth retrying (transient infrastructure problems). */
export function isRetryableError(e: unknown): boolean {
  if (e instanceof JobError) return e.retryable;
  if (e instanceof DomainError) {
    // Business-rule failures will fail again; only conflicts can be transient.
    return e.code === "CONFLICT" || e.code === "RATE_LIMITED";
  }
  if (e && typeof e === "object" && "retryable" in e) return Boolean((e as { retryable: unknown }).retryable);
  // Invalid input/payload (schema validation) will never succeed on retry.
  if (e instanceof Error && e.name === "ZodError") return false;
  // Unknown errors (network, DB timeouts) are retried within max_attempts.
  return true;
}

export const JOB_TYPE_LABEL_JA: Record<JobType, string> = {
  RESEARCH_COLLECTION: "データ収集",
  SIGNAL_EXTRACTION: "シグナル抽出",
  CLUSTER_GENERATION: "クラスタ生成",
  OPPORTUNITY_GENERATION: "事業機会の生成・評価",
  DEEP_RESEARCH: "深掘り調査",
  COMPETITOR_RESEARCH: "競合調査",
  MARKET_SIZE_RESEARCH: "市場規模調査",
  RED_TEAM: "Red Team",
  DAILY_BRIEF: "Daily Brief",
  WATCHLIST_REFRESH: "Watchlist更新",
};

export const JOB_STATUS_LABEL_JA: Record<JobStatus, string> = {
  QUEUED: "待機中",
  PROCESSING: "処理中",
  COMPLETED: "完了",
  FAILED: "失敗",
  RETRYING: "再試行待ち",
  CANCELLED: "キャンセル",
};
