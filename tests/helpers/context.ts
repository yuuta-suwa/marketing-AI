import { DEFAULT_PIPELINE_OPTIONS, type AppContext } from "@/application/context";
import type { AIProvider } from "@/domain/agent/ai-provider";
import type { Actor } from "@/domain/auth/authorization";
import type { MarketConnector } from "@/domain/connector/connector";
import { createDefaultConnectorRegistry, StaticConnectorRegistry, type ConnectorRegistry } from "@/connectors/registry";
import { LocalHashEmbeddingProvider } from "@/infrastructure/ai/local-hash-embeddings";
import { MemoryDatabase } from "@/infrastructure/memory/memory-db";
import { createMemoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { sha256Hex } from "@/lib/hash";
import { silentLogger } from "@/lib/logger";
import { createJobHandlers } from "@/application/jobs/handlers";
import { JobWorker, type JobHandlers, type WorkerOptions } from "@/application/jobs/worker";
import type { Job } from "@/domain/jobs/job";
import { MemoryJobStore } from "@/infrastructure/memory/memory-jobs";

export const NOW = new Date("2026-10-01T00:00:00Z");
export const ALICE: Actor = { userId: "u-alice", organizationId: "org-a", role: "owner" };
export const BOB: Actor = { userId: "u-bob", organizationId: "org-b", role: "owner" };

export function testContext(
  opts: {
    db?: MemoryDatabase;
    actor?: Actor;
    ai?: AIProvider | null;
    connectors?: ConnectorRegistry | MarketConnector[];
    /**
     * true (default): trusted repositories, as used by the worker — most tests run
     * the pipeline directly. false: a member's request-path repositories, which
     * mirror the DB grants (worker-controlled data is rejected).
     */
    trusted?: boolean;
  } = {},
): AppContext & { db: MemoryDatabase } {
  const db = opts.db ?? new MemoryDatabase();
  const actor = opts.actor ?? ALICE;
  const clock = { now: () => NOW };
  const embeddings = new LocalHashEmbeddingProvider();
  const connectors = Array.isArray(opts.connectors)
    ? new StaticConnectorRegistry(opts.connectors)
    : (opts.connectors ?? createDefaultConnectorRegistry({ env: () => undefined, fetch: async () => new Response("{}") }));
  return {
    db,
    actor,
    repos: createMemoryRepositories(db, actor, clock, { system: opts.trusted ?? true }),
    connectors,
    ai: opts.ai ?? null,
    embeddings,
    fallbackEmbeddings: embeddings,
    hash: sha256Hex,
    clock,
    logger: silentLogger,
    options: { ...DEFAULT_PIPELINE_OPTIONS },
  };
}

export const TEST_WORKER_OPTIONS: WorkerOptions = {
  workerId: "test-worker",
  leaseSeconds: 60,
  heartbeatMs: 60_000,
  batchSize: 5,
  backoff: { baseSeconds: 10, maxSeconds: 60, random: () => 0 },
};

/** Worker over the test's memory DB; each job runs as its owner (system repos, org-scoped). */
export function testWorker(
  ctx: AppContext & { db: MemoryDatabase },
  overrides: { handlers?: JobHandlers; options?: Partial<WorkerOptions>; store?: MemoryJobStore; mapContext?: (c: AppContext) => AppContext } = {},
) {
  const store = overrides.store ?? new MemoryJobStore(ctx.db, ctx.clock);
  const worker = new JobWorker({
    store,
    handlers: overrides.handlers ?? createJobHandlers(),
    logger: silentLogger,
    options: { ...TEST_WORKER_OPTIONS, ...overrides.options },
    contextFor: async (job: Job) => {
      const actor: Actor = { userId: job.userId ?? ctx.actor.userId, organizationId: job.organizationId, role: ctx.actor.role };
      const workerCtx = { ...ctx, actor, repos: createMemoryRepositories(ctx.db, actor, ctx.clock, { system: true }) };
      return overrides.mapContext ? overrides.mapContext(workerCtx) : workerCtx;
    },
  });
  return { worker, store };
}

/** Executes everything currently claimable (chained stages included). */
export async function runQueuedJobs(ctx: AppContext & { db: MemoryDatabase }): Promise<number> {
  return testWorker(ctx).worker.drain();
}
