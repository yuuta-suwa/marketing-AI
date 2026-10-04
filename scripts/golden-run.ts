/**
 * PHASE 6 — Golden Research Run (real infrastructure + real market data).
 *
 *   npm run golden-run                     # uses the DEPLOYED worker (polls until done)
 *   npm run golden-run -- --inline-worker  # processes the queue in this process (worker not deployed yet)
 *   npm run golden-run -- --preflight-only # only the live checks
 *
 * Required env (never printed): APP_ENV (staging|production), NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, BRAVE_SEARCH_API_KEY + WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true,
 * ESTAT_APP_ID, ANTHROPIC_API_KEY, GOLDEN_RUN_USER_ID (an existing member/owner of the target org).
 * Optional: GOLDEN_RUN_ORG_ID (default: the user's default organization), GOLDEN_RUN_TIMEOUT_SECONDS (900).
 *
 * MOCK connectors are refused. Output: docs/golden-runs/<runId>.md and .json.
 * Exit codes: 0 MVP_LIVE_VALIDATED · 1 LIVE_VALIDATION_FAILED/PARTIAL · 2 BLOCKED_ON_LIVE_INFRASTRUCTURE.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGoldenResearch } from "@/application/golden/golden-run";
import { renderGoldenRunReport } from "@/application/golden/report";
import { ORG_ROLES, roleAtLeast, type Actor, type OrgRole } from "@/domain/auth/authorization";
import { isTerminalRunStatus } from "@/domain/research/run-state-machine";
import { systemClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/hash";
import { createLogger } from "@/lib/logger";
import { LocalHashEmbeddingProvider } from "@/infrastructure/ai/local-hash-embeddings";
import { createAIProvider, createEmbeddingProvider } from "@/infrastructure/ai/provider-factory";
import { appEnv, appVersion, mockConnectorsRequested } from "@/infrastructure/env-contract";
import { runLivePreflight } from "@/infrastructure/live/preflight";
import { createConnectorRegistryForEnv, pipelineOptionsFromEnv } from "@/infrastructure/server-context";
import { createSupabaseAdminClient } from "@/infrastructure/supabase/admin-client";
import { createSupabaseRepositories } from "@/infrastructure/supabase/supabase-repositories";
import { createWorkerRuntime } from "@/infrastructure/worker/runtime";

const args = new Set(process.argv.slice(2));
const out = (o: unknown) => console.log(JSON.stringify(o));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function blocked(missing: string[]): never {
  out({ kind: "golden-run", status: "BLOCKED_ON_LIVE_INFRASTRUCTURE", missing });
  process.exit(2);
}

async function main() {
  const missing: string[] = [];
  const env = appEnv();
  if (env === "local") missing.push("APP_ENV=staging or APP_ENV=production (the Golden Run must use hosted infrastructure)");
  if (mockConnectorsRequested()) missing.push("CONNECTOR_MOCK_MODE must be false (MOCK sources are not allowed in the Golden Run)");
  if (!process.env.GOLDEN_RUN_USER_ID) missing.push("GOLDEN_RUN_USER_ID (existing member/owner user id in the hosted project)");

  const pre = await runLivePreflight({ llmStructured: true });
  out({
    kind: "preflight",
    connectors: pre.connectors.map((c) => ({ id: c.id, readiness: c.readiness, missingEnv: c.missingEnv, smoke: c.smoke })),
    anthropic: pre.anthropic,
    supabase: pre.supabase,
    credentials: pre.credentials.map((c) => ({ name: c.name, status: c.status, ...(c.detail ? { detail: c.detail } : {}) })),
  });
  for (const c of pre.blocking) missing.push(`${c.name}: ${c.status}${c.detail ? ` (${c.detail})` : ""}`);
  if (!pre.connectors.some((c) => c.readiness === "LIVE_READY")) missing.push("at least one live market source (Brave or e-Stat) must be LIVE_READY");
  if (!pre.anthropic.ok) missing.push("Anthropic must pass count_tokens + a minimal structured-output request");
  if (!pre.supabase.ok) missing.push("Supabase (service role) must be reachable with migrations applied");
  if (missing.length > 0) blocked(missing);
  if (args.has("--preflight-only")) {
    out({ kind: "preflight", status: "READY" });
    return;
  }

  const admin = createSupabaseAdminClient()!;
  const userId = process.env.GOLDEN_RUN_USER_ID!;
  let orgId = process.env.GOLDEN_RUN_ORG_ID;
  if (!orgId) {
    const p = await admin.from("profiles").select("default_organization_id").eq("id", userId).maybeSingle();
    orgId = p.data?.default_organization_id ?? undefined;
  }
  const m = orgId ? await admin.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", userId).maybeSingle() : null;
  const role = m?.data?.role as OrgRole | undefined;
  if (!orgId || !role || !ORG_ROLES.includes(role) || !roleAtLeast(role, "member")) blocked(["GOLDEN_RUN_USER_ID must be a member (or higher) of GOLDEN_RUN_ORG_ID"]);

  const actor: Actor = { userId, organizationId: orgId, role };
  const logger = createLogger({ component: "golden-run", organization_id: orgId });
  const ctx = {
    actor,
    // Acts for the user through the same trusted path as the worker (org-scoped, audited on behalf of the user).
    repos: createSupabaseRepositories(admin, actor, { system: true, onBehalfOf: true }),
    connectors: createConnectorRegistryForEnv(),
    ai: createAIProvider(),
    embeddings: createEmbeddingProvider(),
    fallbackEmbeddings: new LocalHashEmbeddingProvider(),
    hash: sha256Hex,
    clock: systemClock,
    logger,
    options: pipelineOptionsFromEnv(),
  };

  const inline = args.has("--inline-worker");
  const runtime = inline ? createWorkerRuntime({ workerId: `golden-run-${process.pid}` }) : null;
  const timeoutMs = (Number(process.env.GOLDEN_RUN_TIMEOUT_SECONDS) || 900) * 1000;
  const startedAt = Date.now();

  const advanceQueue = async (runId: string) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (runtime) await runtime.worker.drain(50);
      const run = await ctx.repos.research.getRun(runId);
      const pending = (await ctx.repos.jobs.list({ limit: 200 })).filter(
        (j) => Date.parse(j.createdAt) >= startedAt - 1000 && ["QUEUED", "PROCESSING", "RETRYING"].includes(j.status),
      );
      if (run && isTerminalRunStatus(run.status) && pending.length === 0) return;
      if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs / 1000}s waiting for the worker (is it deployed and healthy?)`);
      await sleep(runtime ? 1000 : 5000);
    }
  };

  const result = await runGoldenResearch(ctx, { advanceQueue });
  const md = renderGoldenRunReport(result, { appEnv: env, version: appVersion(), workerMode: inline ? "inline (this process)" : "deployed worker" });
  const dir = join(process.cwd(), "docs", "golden-runs");
  mkdirSync(dir, { recursive: true });
  const base = join(dir, `${result.startedAt.slice(0, 10)}-${result.runId}`);
  writeFileSync(`${base}.md`, md);
  writeFileSync(`${base}.json`, JSON.stringify(result, null, 2));
  out({ kind: "golden-run", status: result.status, runId: result.runId, report: `${base}.md`, stages: result.stages.map((s) => `${s.ok ? "OK" : "NG"} ${s.stage}`) });
  process.exit(result.status === "MVP_LIVE_VALIDATED" ? 0 : 1);
}

main().catch((e) => {
  out({ kind: "golden-run", status: "LIVE_VALIDATION_FAILED", error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
