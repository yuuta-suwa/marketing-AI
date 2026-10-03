import { z } from "zod";
import type { AIProvider, GenerateResult } from "@/domain/agent/ai-provider";
import { SIGNAL_TYPE_LABEL_JA, type SignalType } from "@/domain/signal/signal";

export const CLUSTER_NAMER = "ClusterNamerAgent";

const JA_TERM = /[゠-ヿー]{2,10}|[一-鿿]{2,8}/g;
const EN_TERM = /[a-z][a-z-]{3,20}/gi;
const STOP = new Set([
  "する", "こと", "ため", "これ", "それ", "とても", "本当", "毎回", "いつも", "this", "that", "with", "have",
  "were", "they", "there", "about", "would", "could", "really", "every", "time", "from", "when",
]);

/** Most frequent content terms across texts (document frequency). */
export function topTerms(texts: readonly string[], limit = 2): string[] {
  const df = new Map<string, number>();
  for (const t of texts) {
    const terms = new Set([...(t.match(JA_TERM) ?? []), ...(t.match(EN_TERM) ?? []).map((w) => w.toLowerCase())]);
    for (const term of terms) if (!STOP.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return [...df.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

/** Rule-based naming. Names are labels, not claims; summaries quote evidence. */
export function nameClusterHeuristically(input: {
  dominantType: SignalType;
  problems: string[];
  sourceCount: number;
}): { name: string; summary: string } {
  const terms = topTerms(input.problems);
  const label = SIGNAL_TYPE_LABEL_JA[input.dominantType];
  const name = terms.length > 0 ? `${label}: ${terms.join("・")}` : label;
  const example = input.problems[0]?.slice(0, 80) ?? "";
  return {
    name: name.slice(0, 120),
    summary: `${input.problems.length}件のシグナル（${input.sourceCount}ソース）。代表例:「${example}${
      (input.problems[0]?.length ?? 0) > 80 ? "…" : ""
    }」`,
  };
}

const NamingSchema = z.object({ name: z.string().trim().min(1).max(120), summary: z.string().trim().min(1).max(600) });

/**
 * LLM-assisted naming. The model only sees the member problems; the summary
 * must describe them, not add facts. Output is a label (naming_method = ai).
 */
export async function nameClusterWithLLM(
  provider: AIProvider,
  problems: string[],
): Promise<{ naming: z.infer<typeof NamingSchema>; llm: Omit<GenerateResult<unknown>, "output"> }> {
  const res = await provider.generate({
    agent: CLUSTER_NAMER,
    system:
      "You are ClusterNamerAgent of MARKET RADAR OS. Name a group of customer problems with a short Japanese label (≤ 30 chars) and a 1–2 sentence Japanese summary. Describe only what the problems say; do not add facts, numbers or company names. Respond with JSON only.",
    prompt: JSON.stringify({ problems: problems.slice(0, 30) }),
    schema: NamingSchema,
    maxOutputTokens: 400,
  });
  return { naming: res.output, llm: { usage: res.usage, costUsd: res.costUsd, provider: res.provider, model: res.model } };
}
