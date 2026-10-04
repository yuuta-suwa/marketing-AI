import "server-only";
import { appEnv } from "../env-contract";
import { runtimeMode } from "../runtime-mode";
import { createWorkerRuntime, type WorkerRuntime } from "./runtime";

const g = globalThis as unknown as { __mroEmbeddedWorker?: { runtime: WorkerRuntime; running: boolean; again: boolean } };

/**
 * Embedded worker: the demo store lives in this process, so demo mode always
 * drains in-process; with Supabase it is a development convenience only
 * (WORKER_MODE=embedded outside production). Production uses `npm run worker`.
 */
export function embeddedWorkerEnabled(): boolean {
  if (runtimeMode() === "demo") return true;
  return appEnv() === "local" && process.env.WORKER_MODE === "embedded";
}

/**
 * Nudges the in-process worker to drain the queue. Fire-and-forget: the
 * caller (a server action) returns immediately; the drain runs detached from
 * the request. Production never uses this — the external worker does.
 */
export function kickEmbeddedWorker(): void {
  if (!embeddedWorkerEnabled()) return;
  g.__mroEmbeddedWorker ??= { runtime: createWorkerRuntime({ workerId: `embedded-${process.pid}` }), running: false, again: false };
  const state = g.__mroEmbeddedWorker;
  if (state.running) {
    state.again = true;
    return;
  }
  state.running = true;
  setTimeout(async () => {
    try {
      do {
        state.again = false;
        await state.runtime.worker.drain(200);
      } while (state.again);
    } catch (e) {
      state.runtime.logger.error("embedded_worker.failed", { error: (e as Error).message });
    } finally {
      state.running = false;
    }
    // Retries scheduled for later: poll again until nothing is pending.
    const pending = (await state.runtime.store.stats().catch(() => [])).some((r) => (r.status === "RETRYING" || r.status === "QUEUED") && r.count > 0);
    if (pending) setTimeout(kickEmbeddedWorker, 2_000);
  }, 0);
}
