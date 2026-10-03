import "server-only";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "@/domain/agent/ai-provider";

type EmbeddingResponse = { data: Array<{ index: number; embedding: number[] }>; usage?: { prompt_tokens?: number } };

/**
 * Hosted semantic embeddings (OpenAI `text-embedding-3-small`, 1536 dims —
 * matches the pgvector column). Selected with EMBEDDING_PROVIDER=openai.
 * Batches of 96 inputs; errors throw so the pipeline falls back to local
 * embeddings instead of failing the run.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai";
  readonly dimensions = EMBEDDING_DIMENSIONS;
  static readonly USD_PER_MTOK = 0.02;

  constructor(
    private readonly apiKey: string,
    readonly model = "text-embedding-3-small",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]) {
    const vectors: number[][] = new Array(texts.length);
    let tokens = 0;
    for (let start = 0; start < texts.length; start += 96) {
      const batch = texts.slice(start, start + 96).map((t) => t.slice(0, 8000) || " ");
      const res = await this.fetchImpl("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: batch, dimensions: this.dimensions }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
      const json = (await res.json()) as EmbeddingResponse;
      for (const d of json.data) vectors[start + d.index] = d.embedding;
      tokens += json.usage?.prompt_tokens ?? 0;
    }
    if (vectors.some((v) => !v || v.length !== this.dimensions)) throw new Error("embeddings: unexpected response shape");
    return { vectors, costUsd: (tokens / 1_000_000) * OpenAIEmbeddingProvider.USD_PER_MTOK, usage: { inputTokens: tokens, outputTokens: 0 } };
  }
}
