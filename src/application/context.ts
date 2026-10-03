import type { AIProvider, EmbeddingProvider } from "@/domain/agent/ai-provider";
import type { Actor } from "@/domain/auth/authorization";
import type { ConnectorRegistry } from "@/connectors/registry";
import type { Clock } from "@/lib/clock";
import type { Logger } from "@/lib/logger";
import type { Hasher } from "@/domain/source/normalize";
import type { Repositories } from "./ports/repositories";

export type PipelineOptions = {
  connectorTimeoutMs: number;
  connectorMaxRetries: number;
  maxOpportunitiesPerRun: number;
  clusterThreshold: number;
  maxCallsPerAgent: number;
  llmEvidenceBatchSize: number;
};

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  connectorTimeoutMs: 20_000,
  connectorMaxRetries: 1,
  maxOpportunitiesPerRun: 5,
  clusterThreshold: 0.35,
  maxCallsPerAgent: 12,
  llmEvidenceBatchSize: 40,
};

/** Everything a use case needs, bound to one authenticated actor. */
export type AppContext = {
  actor: Actor;
  repos: Repositories;
  connectors: ConnectorRegistry;
  /** Null when no LLM is configured — deterministic agents are used. */
  ai: AIProvider | null;
  embeddings: EmbeddingProvider;
  /** Zero-cost local embeddings used when the budget stops paid embeddings. */
  fallbackEmbeddings: EmbeddingProvider;
  hash: Hasher;
  clock: Clock;
  logger: Logger;
  options: PipelineOptions;
};
