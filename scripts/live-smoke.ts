/**
 * Live readiness + real-scenario smoke test.
 *
 *   npm run smoke:live                    # credential validation + ONE minimal live request per configured connector
 *   npm run smoke:live -- --workflow      # + the real research scenario (in-memory store, real connectors/LLM)
 *   npm run smoke:live -- --workflow --allow-mock   # dev only: run the scenario on MOCK connectors (labelled)
 *
 * Never runs expensive queries: readiness uses the smallest page of each API
 * (Anthropic: the free token-counting endpoint). The workflow obeys the
 * MAX_* hard limits. Nothing is written to Supabase.
 * Exit codes: 0 ok · 1 a live check failed · 2 credentials missing for the workflow.
 */
import { connectorReadiness } from "@/application/connectors/readiness";
import { DEFAULT_PIPELINE_OPTIONS, type AppContext } from "@/application/context";
import { createJobHandlers } from "@/application/jobs/handlers";
import { JobWorker } from "@/application/jobs/worker";
import { hardLimitsFromEnv } from "@/application/limits";
import { runResearchSmoke, SMOKE_QUERY } from "@/application/smoke/research-smoke";
import { createDefaultConnectorRegistry } from "@/connectors/registry";
import { processEnv } from "@/connectors/http";
import type { Actor } from "@/domain/auth/authorization";
import { classifyConnectorError } from "@/domain/connector/connector";
import { systemClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/hash";
import { createLogger } from "@/lib/logger";
import { AnthropicProvider } from "@/infrastructure/ai/anthropic-provider";
import { LocalHashEmbeddingProvider } from "@/infrastructure/ai/local-hash-embeddings";
import { createAIProvider, createEmbeddingProvider } from "@/infrastructure/ai/provider-factory";
import { mockConnectorsAllowed } from "@/infrastructure/env-contract";
import { MemoryDatabase } from "@/infrastructure/memory/memory-db";
import { MemoryJobStore } from "@/infrastructure/memory/memory-jobs";
import { createMemoryRepositories } from "@/infrastructure/memory/memory-repositories";

const args = new Set(process.argv.slice(2));
const out = (o: unknown) => console.log(JSON.stringify(o));

async function anthropicReadiness() {
  if (!process.env.ANTHROPIC_API_KEY) return { id: "anthropic", readiness: "READY_NEEDS_CREDENTIALS", missingEnv: ["ANTHROPIC_API_KEY"] };
  const p = new AnthropicProvider(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL || undefined);
  const started = Date.now();
  try {
    const r = await p.ping();
    return { id: "anthropic", readiness: "LIVE_READY", missingEnv: [], smoke: { ok: true, latencyMs: Date.now() - started, detail: r.detail, costUsd: 0 } };
  } catch (e) {
    const status = (e as { status?: number }).status;
    const errorClass = status === 401 || status === 403 ? "AUTH" : status === 429 ? "RATE_LIMITED" : classifyConnectorError(e).class;
    return { id: "anthropic", readiness: "FAILED", missingEnv: [], smoke: { ok: false, latencyMs: Date.now() - started, errorClass, message: (e as Error).message.slice(0, 300) } };
  }
}

async function main() {
  const live = createDefaultConnectorRegistry();
  const readiness = [];
  for (const c of live.list()) readiness.push(await connectorReadiness(c, { env: processEnv, live: true }));
  readiness.push(await anthropicReadiness());
  for (const r of readiness) out({ kind: "readiness", ...r });
  const failed = readiness.filter((r) => r.readiness === "FAILED");

  if (!args.has("--workflow")) process.exit(failed.length > 0 ? 1 : 0);

  const liveSources = readiness.filter((r) => (r.id === "web_search" || r.id === "estat") && r.readiness === "LIVE_READY");
  let registry = live;
  if (liveSources.length === 0) {
    if (!args.has("--allow-mock")) {
      out({ kind: "workflow", status: "READY_NEEDS_CREDENTIALS", required: ["BRAVE_SEARCH_API_KEY + WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true", "and/or ESTAT_APP_ID"] });
      process.exit(2);
    }
    if (!mockConnectorsAllowed()) {
      out({ kind: "workflow", status: "REJECTED", reason: "--allow-mock is not permitted with NODE_ENV=production (set ENABLE_MOCK_CONNECTORS=true for staging)" });
      process.exit(2);
    }
    registry = createDefaultConnectorRegistry({ mock: {} });
    out({ kind: "workflow", warning: "MOCK connectors: the result proves the pipeline mechanics only, NOT real market evidence" });
  }

  const db = new MemoryDatabase();
  const actor: Actor = { userId: "smoke-user", organizationId: "smoke-org", role: "owner" };
  const logger = createLogger({ component: "live-smoke" });
  const ctx: AppContext = {
    actor,
    repos: createMemoryRepositories(db, actor, systemClock),
    connectors: registry,
    ai: createAIProvider(),
    embeddings: createEmbeddingProvider(),
    fallbackEmbeddings: new LocalHashEmbeddingProvider(),
    hash: sha256Hex,
    clock: systemClock,
    logger,
    options: { ...DEFAULT_PIPELINE_OPTIONS, limits: hardLimitsFromEnv() },
  };
  const worker = new JobWorker({
    store: new MemoryJobStore(db, systemClock),
    handlers: createJobHandlers(),
    logger,
    options: { workerId: "live-smoke", leaseSeconds: 300, heartbeatMs: 30_000, batchSize: 1 },
    contextFor: async (job) => ({ ...ctx, repos: createMemoryRepositories(db, { ...actor, organizationId: job.organizationId }, systemClock, { system: true }) }),
  });
  const report = await runResearchSmoke(ctx, worker, { query: process.env.SMOKE_QUERY || SMOKE_QUERY });
  out({ kind: "workflow", ...report, costUsd: (await ctx.repos.research.getRun(report.runId!))?.costUsd ?? null });
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  out({ kind: "error", error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
