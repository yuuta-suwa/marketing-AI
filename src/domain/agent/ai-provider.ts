import type { z } from "zod";

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type GenerateRequest<T> = {
  /** Agent name for logging and cost attribution. */
  agent: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  temperature?: number;
};

export type GenerateResult<T> = {
  output: T;
  usage: TokenUsage;
  costUsd: number;
  provider: string;
  model: string;
};

/**
 * Provider-agnostic structured generation. Implementations MUST validate the
 * output with `schema` and throw on invalid output; callers never receive
 * unvalidated model text.
 */
export interface AIProvider {
  readonly id: string;
  readonly model: string;
  /** False for deterministic/offline providers. */
  readonly isLLM: boolean;
  estimateCost(inputChars: number, maxOutputTokens: number): number;
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<{ vectors: number[][]; costUsd: number; usage: TokenUsage }>;
}

export const EMBEDDING_DIMENSIONS = 1536;
