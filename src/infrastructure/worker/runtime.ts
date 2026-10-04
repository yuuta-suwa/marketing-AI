import "server-only";
import { hostname } from "node:os";
import type { AppContext } from "@/application/context";
import { createJobHandlers } from "@/application/jobs/handlers";
import type { JobStore } from "@/application/jobs/ports";
import { JobWorker, type WorkerOptions } from "@/application/jobs/worker";
import { ORG_ROLES, roleAtLeast, type Actor, type OrgRole } from "@/domain/auth/authorization";
import type { Job } from "@/domain/jobs/job";
import { DomainError } from "@/domain/shared/errors";
import { systemClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/hash";
import { createLogger, type Logger } from "@/lib/logger";
import { LocalHashEmbeddingProvider } from "../ai/local-hash-embeddings";
import { createAIProvider, createEmbeddingProvider } from "../ai/provider-factory";
import { MemoryJobStore } from "../memory/memory-jobs";
import { createMemoryRepositories } from "../memory/memory-repositories";
import { runtimeMode } from "../runtime-mode";
import { createConnectorRegistryForEnv, DEMO_ACTOR, demoDatabase, pipelineOptionsFromEnv } from "../server-context";
import { createSupabaseAdminClient } from "../supabase/admin-client";
import { SupabaseJobStore } from "../supabase/supabase-jobs";
import { createSupabaseRepositories } from "../supabase/supabase-repositories";

function contextFor(actor: Actor, repos: AppContext["repos"], logger: Logger): AppContext {
  return {
    actor,
    repos,
    connectors: createConnectorRegistryForEnv(),
    ai: createAIProvider(),
    embeddings: createEmbeddingProvider(),
    fallbackEmbeddings: new LocalHashEmbeddingProvider(),
    hash: sha256Hex,
    clock: systemClock,
    logger,
    options: pipelineOptionsFromEnv(),
  };
}

const intEnv = (name: string, fallback: number, min: number, max: number) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= min && raw <= max ? Math.floor(raw) : fallback;
};

export function workerOptionsFromEnv(): WorkerOptions {
  const leaseSeconds = intEnv("WORKER_LEASE_SECONDS", 120, 30, 3600);
  return {
    workerId: (process.env.WORKER_ID || `${hostname()}-${process.pid}`).slice(0, 200),
    leaseSeconds,
    heartbeatMs: Math.max(5_000, Math.floor((leaseSeconds * 1000) / 4)),
    batchSize: intEnv("WORKER_CONCURRENCY", 1, 1, 10),
    backoff: { baseSeconds: 15, maxSeconds: 900 },
  };
}

export type WorkerRuntime = { worker: JobWorker; store: JobStore; mode: "supabase" | "demo"; logger: Logger };

/**
 * Builds the worker for the current environment:
 *   supabase → Postgres queue via the service-role client (worker process only);
 *   demo     → the in-process demo store (development).
 * The job's owner is re-verified for every job: a user who lost access to the
 * organization (or whose role dropped below member) cannot have work executed.
 */
export function createWorkerRuntime(overrides: Partial<WorkerOptions> = {}): WorkerRuntime {
  const options = { ...workerOptionsFromEnv(), ...overrides };
  const logger = createLogger({ component: "worker", worker_id: options.workerId });
  const handlers = createJobHandlers();
  // The worker needs the URL + service-role key, not the browser's publishable key.
  const admin = createSupabaseAdminClient();

  if (!admin && runtimeMode() === "demo") {
    const db = demoDatabase();
    const store = new MemoryJobStore(db, systemClock);
    const worker = new JobWorker({
      store,
      handlers,
      logger,
      options,
      contextFor: async (job: Job) => {
        if (job.organizationId !== DEMO_ACTOR.organizationId || job.userId !== DEMO_ACTOR.userId) {
          throw new DomainError("FORBIDDEN", "job owner is not a member of the organization");
        }
        return contextFor(DEMO_ACTOR, createMemoryRepositories(db, DEMO_ACTOR, systemClock, { system: true }), logger.child({ organization_id: job.organizationId }));
      },
    });
    return { worker, store, mode: "demo", logger };
  }

  if (!admin) {
    throw new Error("Worker requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or MRO_DEMO_MODE=true outside production)");
  }
  const store = new SupabaseJobStore(admin);
  const worker = new JobWorker({
    store,
    handlers,
    logger,
    options,
    contextFor: async (job: Job) => {
      if (!job.userId) throw new DomainError("FORBIDDEN", "job has no owner");
      const res = await admin
        .from("organization_members")
        .select("role")
        .eq("organization_id", job.organizationId)
        .eq("user_id", job.userId)
        .maybeSingle();
      if (res.error) throw new Error(`membership lookup: ${res.error.message}`);
      const role = res.data?.role as OrgRole | undefined;
      if (!role || !ORG_ROLES.includes(role) || !roleAtLeast(role, "member")) {
        throw new DomainError("FORBIDDEN", "job owner is no longer a member of the organization");
      }
      const actor: Actor = { userId: job.userId, organizationId: job.organizationId, role };
      // Service role + explicit organization_id filters in every repository call.
      return contextFor(actor, createSupabaseRepositories(admin, actor, { system: true, onBehalfOf: true }), logger.child({ organization_id: job.organizationId }));
    },
  });
  return { worker, store, mode: "supabase", logger };
}
