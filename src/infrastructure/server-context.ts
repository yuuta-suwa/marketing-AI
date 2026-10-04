import "server-only";
import { DEFAULT_PIPELINE_OPTIONS, type AppContext } from "@/application/context";
import type { Repositories } from "@/application/ports/repositories";
import { createDefaultConnectorRegistry } from "@/connectors/registry";
import { ORG_ROLES, type Actor, type OrgRole } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";
import { systemClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/hash";
import { createLogger } from "@/lib/logger";
import { hardLimitsFromEnv } from "@/application/limits";
import { resolveMockConnectorOptions } from "./env-contract";
import { LocalHashEmbeddingProvider } from "./ai/local-hash-embeddings";
import { createAIProvider, createEmbeddingProvider } from "./ai/provider-factory";
import { MemoryDatabase } from "./memory/memory-db";
import { createMemoryRepositories } from "./memory/memory-repositories";
import { runtimeMode } from "./runtime-mode";
import { createSupabaseServerClient } from "./supabase/server-client";
import { createSupabaseRepositories } from "./supabase/supabase-repositories";

export const DEMO_ACTOR: Actor = { userId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-0000000000a1", role: "owner" };

const globalStore = globalThis as unknown as { __mroDemoDb?: MemoryDatabase };
export function demoDatabase(): MemoryDatabase {
  if (!globalStore.__mroDemoDb) {
    globalStore.__mroDemoDb = new MemoryDatabase();
    // The single demo user operates the in-process demo platform.
    globalStore.__mroDemoDb.platformOperators.add(DEMO_ACTOR.userId);
  }
  return globalStore.__mroDemoDb;
}

export type Session = { actor: Actor; email: string | null; repos: Repositories; mode: "supabase" | "demo" };

/**
 * Resolves the signed-in user and their organization role. The role comes
 * from organization_members (server-verified), never from user_metadata.
 * Returns null when nobody is signed in.
 */
export async function getSession(): Promise<Session | null> {
  const mode = runtimeMode();
  if (mode === "demo") {
    return { actor: DEMO_ACTOR, email: "demo@local", repos: createMemoryRepositories(demoDatabase(), DEMO_ACTOR, systemClock), mode };
  }
  if (mode !== "supabase") return null;

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("default_organization_id").eq("id", user.id).maybeSingle();
  let membershipQuery = supabase.from("organization_members").select("organization_id, role").eq("user_id", user.id);
  if (profile?.default_organization_id) membershipQuery = membershipQuery.eq("organization_id", profile.default_organization_id);
  const { data: membership } = await membershipQuery.order("created_at").limit(1).maybeSingle();
  if (!membership || !ORG_ROLES.includes(membership.role as OrgRole)) return null;

  const actor: Actor = { userId: user.id, organizationId: membership.organization_id, role: membership.role as OrgRole };
  return { actor, email: user.email ?? null, repos: createSupabaseRepositories(supabase, actor), mode };
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new DomainError("FORBIDDEN", "Authentication required");
  return session;
}

/**
 * Mock connectors (canned responses, items labelled [MOCK]) are used only when
 * CONNECTOR_MOCK_MODE=true AND (NODE_ENV != production OR ENABLE_MOCK_CONNECTORS=true).
 * A production process that asks for mocks without the explicit opt-in is
 * rejected with an error — it never silently runs on synthetic data, and
 * missing credentials never fall back to mocks.
 */
export function connectorMockOptions(env: Record<string, string | undefined> = process.env): { fail?: string[] } | undefined {
  return resolveMockConnectorOptions(env);
}

/** True when this process runs connectors in MOCK mode (persistent UI badge). */
export function mockConnectorsActive(): boolean {
  try {
    return connectorMockOptions() !== undefined;
  } catch {
    return false;
  }
}

/** Connector registry for any process (web, worker, cron) — one policy everywhere. */
export function createConnectorRegistryForEnv() {
  return createDefaultConnectorRegistry({ mock: connectorMockOptions() });
}

/** Operator limits + pipeline defaults for any process. */
export function pipelineOptionsFromEnv(): AppContext["options"] {
  return { ...DEFAULT_PIPELINE_OPTIONS, limits: hardLimitsFromEnv() };
}

export function buildAppContext(session: Session): AppContext {
  const fallback = new LocalHashEmbeddingProvider();
  return {
    actor: session.actor,
    repos: session.repos,
    connectors: createConnectorRegistryForEnv(),
    ai: createAIProvider(),
    embeddings: createEmbeddingProvider(),
    fallbackEmbeddings: fallback,
    hash: sha256Hex,
    clock: systemClock,
    logger: createLogger({ organization_id: session.actor.organizationId }),
    options: pipelineOptionsFromEnv(),
  };
}
