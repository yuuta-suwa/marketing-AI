import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "@/domain/agent/ai-provider";

/** FNV-1a 32-bit. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function featuresOf(text: string): string[] {
  const norm = text.normalize("NFKC").toLowerCase();
  const features: string[] = [];
  // CJK: character bigrams (no word boundaries in Japanese).
  const cjk = norm.replace(/[^぀-ヿ一-鿿ー]/g, " ");
  for (const chunk of cjk.split(/\s+/)) {
    for (let i = 0; i + 1 < chunk.length; i++) features.push(`b:${chunk.slice(i, i + 2)}`);
  }
  // Latin: lowercase words.
  for (const w of norm.match(/[a-z][a-z0-9'-]{2,}/g) ?? []) features.push(`w:${w}`);
  return features;
}

/**
 * Deterministic, offline embedding via feature hashing (signed). Zero cost.
 * Good enough for lexical clustering in the MVP and as a budget fallback;
 * swap for a semantic provider via EMBEDDING_PROVIDER.
 */
export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-hash";
  readonly model = "fnv-bigram-v1";
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(texts: string[]) {
    const vectors = texts.map((t) => {
      const v = new Array<number>(this.dimensions).fill(0);
      for (const f of featuresOf(t)) {
        const h = fnv1a(f);
        v[h % this.dimensions] += (h & 0x80000000) === 0 ? 1 : -1;
      }
      const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0));
      return norm === 0 ? v : v.map((x) => x / norm);
    });
    return { vectors, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
