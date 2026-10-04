import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { AppContext } from "@/application/context";
import type { SystemDirectory, SystemContextFactory } from "@/application/executive/scheduled";
import { systemClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/hash";
import { createLogger } from "@/lib/logger";
import { LocalHashEmbeddingProvider } from "./ai/local-hash-embeddings";
import { createAIProvider, createEmbeddingProvider } from "./ai/provider-factory";
import { createMemoryRepositories } from "./memory/memory-repositories";
import { runtimeMode } from "./runtime-mode";
import { createConnectorRegistryForEnv, demoDatabase, pipelineOptionsFromEnv } from "./server-context";
import { createSupabaseAdminClient } from "./supabase/admin-client";
import { SupabaseJobStore } from "./supabase/supabase-jobs";
import { MemoryJobStore } from "./memory/memory-jobs";
import type { JobStore } from "@/application/jobs/ports";
import { mapWatchlist } from "./supabase/supabase-executive";
import { createSupabaseRepositories } from "./supabase/supabase-repositories";

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>`. */
export function cronAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

function baseContext(repos: AppContext["repos"], organizationId: string, userId: string): AppContext {
  return {
    actor: { userId, organizationId, role: "admin" },
    repos,
    connectors: createConnectorRegistryForEnv(),
    ai: createAIProvider(),
    embeddings: createEmbeddingProvider(),
    fallbackEmbeddings: new LocalHashEmbeddingProvider(),
    hash: sha256Hex,
    clock: systemClock,
    logger: createLogger({ organization_id: organizationId, job: "system" }),
    options: pipelineOptionsFromEnv(),
  };
}

export function systemJobDeps(): { dir: SystemDirectory; ctxFor: SystemContextFactory; store: JobStore } | null {
  if (runtimeMode() === "demo") {
    const db = demoDatabase();
    return {
      store: new MemoryJobStore(db, systemClock),
      dir: {
        listActiveWatchlists: async () => [...db.watchlists.values()].filter((w) => w.active),
        listBriefRecipients: async () => {
          const orgs = new Set([...db.runs.values()].map((r) => `${r.organizationId}:${r.createdBy}`));
          return [...orgs].map((k) => ({ organizationId: k.split(":")[0], userId: k.split(":")[1] }));
        },
      },
      ctxFor: (org, user) => baseContext(createMemoryRepositories(db, { userId: user, organizationId: org, role: "admin" }, systemClock, { system: true }), org, user),
    };
  }
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  return {
    store: new SupabaseJobStore(admin),
    dir: {
      async listActiveWatchlists() {
        const res = await admin.from("watchlists").select().eq("active", true).limit(5000);
        if (res.error) throw new Error(res.error.message);
        return (res.data ?? []).map(mapWatchlist);
      },
      async listBriefRecipients() {
        const res = await admin.from("organization_members").select("organization_id, user_id, role").eq("role", "owner").limit(5000);
        if (res.error) throw new Error(res.error.message);
        const seen = new Set<string>();
        return (res.data ?? []).flatMap((m) => (seen.has(m.organization_id) ? [] : (seen.add(m.organization_id), [{ organizationId: m.organization_id as string, userId: m.user_id as string }])));
      },
    },
    ctxFor: (org, user) => baseContext(createSupabaseRepositories(admin, { userId: user, organizationId: org, role: "admin" }, { system: true }), org, user),
  };
}
