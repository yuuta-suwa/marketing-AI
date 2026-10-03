import "server-only";
import { DEFAULT_PIPELINE_OPTIONS, type AppContext } from "@/application/context";
import type { Repositories } from "@/application/ports/repositories";
import { createDefaultConnectorRegistry } from "@/connectors/registry";
import { ORG_ROLES, type Actor, type OrgRole } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";
import { systemClock } from "@/lib/clock";
import { sha256Hex } from "@/lib/hash";
import { createLogger } from "@/lib/logger";
import { LocalHashEmbeddingProvider } from "./ai/local-hash-embeddings";
import { createAIProvider, createEmbeddingProvider } from "./ai/provider-factory";
import { MemoryDatabase } from "./memory/memory-db";
import { createMemoryRepositories } from "./memory/memory-repositories";
import { runtimeMode } from "./runtime-mode";
import { createSupabaseServerClient } from "./supabase/server-client";
import { createSupabaseRepositories } from "./supabase/supabase-repositories";

export const DEMO_ACTOR: Actor = { userId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-0000000000a1", role: "owner" };

const globalStore = globalThis as unknown as { __mroDemoDb?: MemoryDatabase };
function demoDb(): MemoryDatabase {
  globalStore.__mroDemoDb ??= new MemoryDatabase();
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
    return { actor: DEMO_ACTOR, email: "demo@local", repos: createMemoryRepositories(demoDb(), DEMO_ACTOR, systemClock), mode };
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

export function buildAppContext(session: Session): AppContext {
  const fallback = new LocalHashEmbeddingProvider();
  return {
    actor: session.actor,
    repos: session.repos,
    connectors: createDefaultConnectorRegistry(),
    ai: createAIProvider(),
    embeddings: createEmbeddingProvider(),
    fallbackEmbeddings: fallback,
    hash: sha256Hex,
    clock: systemClock,
    logger: createLogger({ organization_id: session.actor.organizationId }),
    options: { ...DEFAULT_PIPELINE_OPTIONS },
  };
}
