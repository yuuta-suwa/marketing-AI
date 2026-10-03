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

export const NOW = new Date("2026-10-01T00:00:00Z");
export const ALICE: Actor = { userId: "u-alice", organizationId: "org-a", role: "owner" };
export const BOB: Actor = { userId: "u-bob", organizationId: "org-b", role: "owner" };

export function testContext(
  opts: {
    db?: MemoryDatabase;
    actor?: Actor;
    ai?: AIProvider | null;
    connectors?: ConnectorRegistry | MarketConnector[];
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
    repos: createMemoryRepositories(db, actor, clock),
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
