/** Worker liveness as published by each worker process (statuses only, no secrets). */
export type WorkerSnapshot = {
  workerId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  jobsProcessed: number;
  jobsFailed: number;
  /** Job type being processed (job ids are not shown: workers are cross-tenant). */
  currentJobType: string | null;
  busy: boolean;
  version: string;
  appEnv: string;
  /** Credential statuses (CONFIGURED/MISSING/INVALID/EXPIRED/RATE_LIMITED/READY) by variable name. */
  diagnostics: Record<string, string>;
};

export type WorkerHealthStatus = "HEALTHY" | "DEGRADED" | "OFFLINE";

export const HEARTBEAT_FRESH_MS = 90_000;
export const HEARTBEAT_STALE_MS = 5 * 60_000;

/**
 * HEALTHY  — at least one worker heartbeat within 90 s and no failure storm
 * DEGRADED — freshest heartbeat 90 s–5 min old, the queue waits > 5 min, or
 *            more than half of a worker's ≥ 4 processed jobs failed
 * OFFLINE  — no heartbeat within 5 min (jobs will wait in the queue)
 */
export function workerHealthStatus(
  workers: readonly WorkerSnapshot[],
  now: Date,
  queue: { oldestQueuedSeconds: number | null } = { oldestQueuedSeconds: null },
): { status: WorkerHealthStatus; reasons: string[] } {
  const age = (w: WorkerSnapshot) => now.getTime() - Date.parse(w.lastHeartbeatAt);
  const alive = workers.filter((w) => age(w) <= HEARTBEAT_STALE_MS);
  if (alive.length === 0) {
    return { status: "OFFLINE", reasons: [workers.length ? "直近5分間ワーカーのハートビートがありません" : "ワーカーが一度も起動していません"] };
  }
  const reasons: string[] = [];
  if (!alive.some((w) => age(w) <= HEARTBEAT_FRESH_MS)) reasons.push("ハートビートが遅延しています（90秒超）");
  for (const w of alive) {
    if (w.jobsProcessed >= 4 && w.jobsFailed / w.jobsProcessed > 0.5) reasons.push(`${w.workerId}: 失敗率が高い（${w.jobsFailed}/${w.jobsProcessed}）`);
  }
  if (queue.oldestQueuedSeconds !== null && queue.oldestQueuedSeconds > 300) reasons.push(`キュー待ちが${Math.round(queue.oldestQueuedSeconds / 60)}分を超えています`);
  return { status: reasons.length ? "DEGRADED" : "HEALTHY", reasons };
}
