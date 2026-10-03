import "server-only";
import type { AIProvider, EmbeddingProvider } from "@/domain/agent/ai-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { LocalHashEmbeddingProvider } from "./local-hash-embeddings";

export type ProviderStatus = { id: string; configured: boolean; implemented: boolean; note: string };

/**
 * Chooses providers from server-side env. AI_PROVIDER: anthropic | none.
 * openai / gemini are reserved ids: the AIProvider port is provider-agnostic,
 * adapters land in a later milestone (see docs/AGENTS.md).
 */
export function createAIProvider(env: NodeJS.ProcessEnv = process.env): AIProvider | null {
  const id = (env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? "anthropic" : "none")).toLowerCase();
  if (id === "anthropic" && env.ANTHROPIC_API_KEY) {
    const effort = env.ANTHROPIC_EFFORT === "low" || env.ANTHROPIC_EFFORT === "high" ? env.ANTHROPIC_EFFORT : "medium";
    return new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || undefined, effort);
  }
  return null;
}

export function createEmbeddingProvider(): EmbeddingProvider {
  return new LocalHashEmbeddingProvider();
}

export function providerStatuses(env: NodeJS.ProcessEnv = process.env): ProviderStatus[] {
  return [
    { id: "anthropic", configured: Boolean(env.ANTHROPIC_API_KEY), implemented: true, note: "ANTHROPIC_API_KEY / ANTHROPIC_MODEL" },
    { id: "openai", configured: Boolean(env.OPENAI_API_KEY), implemented: false, note: "Adapter planned (M2)" },
    { id: "gemini", configured: Boolean(env.GEMINI_API_KEY), implemented: false, note: "Adapter planned (M2)" },
    { id: "local-hash (embeddings)", configured: true, implemented: true, note: "Deterministic offline embeddings" },
  ];
}
