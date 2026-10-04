/**
 * MARKET RADAR OS background worker (standalone Node process).
 *
 *   npm run worker            # long-running: polls the Postgres job queue
 *   npm run worker -- --once  # drain what is ready, then exit (cron / CI)
 *
 * Runs independently of the Vercel/Next request lifecycle. Needs the
 * service-role key; never deploy it with the frontend's public env only.
 */
import { createServer } from "node:http";
import { assertEnvironment, EnvironmentError } from "@/infrastructure/env-contract";
import { createWorkerRuntime } from "@/infrastructure/worker/runtime";

async function main() {
  const once = process.argv.includes("--once");
  try {
    const report = assertEnvironment("worker");
    for (const w of report.warnings) console.warn(JSON.stringify({ level: "warn", msg: "env.warning", detail: w }));
    for (const m of report.missingConnectorCredentials) {
      console.warn(JSON.stringify({ level: "warn", msg: "connector.ready_needs_credentials", connector: m.unlocks, env: m.env }));
    }
  } catch (e) {
    if (e instanceof EnvironmentError) {
      console.error(JSON.stringify({ level: "error", msg: "worker.invalid_environment", problems: e.problems }));
      process.exit(78); // EX_CONFIG
    }
    throw e;
  }

  const runtime = createWorkerRuntime();
  const { worker, store, logger } = runtime;

  if (once) {
    const n = await worker.drain();
    logger.info("worker.drained", { result_count: n });
    return;
  }

  const controller = new AbortController();
  const shutdown = (signal: string) => {
    logger.info("worker.shutdown_requested", { signal });
    controller.abort();
    // Hard stop if a job does not reach a checkpoint in time; its lease then expires and it is retried.
    setTimeout(() => process.exit(0), 30_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  const port = Number(process.env.WORKER_HEALTH_PORT);
  if (Number.isInteger(port) && port > 0) {
    createServer(async (req, res) => {
      if (req.url !== "/healthz") {
        res.writeHead(404).end();
        return;
      }
      try {
        const stats = await store.stats();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, busy: worker.busy, queue: stats }));
      } catch (e) {
        res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
    }).listen(port);
  }

  const idleMs = Number(process.env.WORKER_POLL_INTERVAL_MS) || 2_000;
  await worker.runLoop({ idleMs, signal: controller.signal });
}

main().catch((e) => {
  console.error(JSON.stringify({ level: "error", msg: "worker.crashed", error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
