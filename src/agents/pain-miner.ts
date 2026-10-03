import type { AIProvider, GenerateResult } from "@/domain/agent/ai-provider";
import { validateEvidenceRefs, type Evidence } from "@/domain/evidence/evidence";
import type { ResearchDirective } from "@/domain/research/directive";
import { SignalExtractionOutputSchema, SIGNAL_TYPES, type MarketSignal } from "@/domain/signal/signal";
import { HEURISTIC_EXTRACTOR_ID, extractSignalsHeuristically } from "./heuristics/signal-heuristics";

export const PAIN_MINER = "PainMinerAgent";

const SYSTEM = `You are PainMinerAgent of MARKET RADAR OS.
Extract market signals (unmet needs) from the evidence excerpts provided.
Hard rules:
- Every signal MUST cite one or more evidence ids from the list given. Never invent ids.
- Use only what the evidence says. If something is not stated, omit the field.
- Scores are 0-100 integers reflecting what the text supports, not what you imagine.
- confidence: LOW unless several independent excerpts agree.
- signalType must be one of: ${SIGNAL_TYPES.join(", ")}.
- Skip excerpts that contain no problem, request, workaround, switching, shortage or payment intent.
Respond with JSON {"signals": [...]}.`;

export type ExtractionResult = {
  signals: MarketSignal[];
  extractedBy: string;
  rejected: number;
  llm?: Omit<GenerateResult<unknown>, "output">;
};

/** Evidence ids returned by the model are checked against what it was given. */
export function sanitizeExtractedSignals(
  signals: readonly MarketSignal[],
  known: ReadonlySet<string>,
): { kept: MarketSignal[]; rejected: number } {
  const kept: MarketSignal[] = [];
  let rejected = 0;
  for (const s of signals) {
    const { valid, invalid } = validateEvidenceRefs(s.evidenceIds, known);
    if (invalid.length > 0 || valid.length === 0) {
      rejected++;
      continue;
    }
    kept.push({ ...s, evidenceIds: valid });
  }
  return { kept, rejected };
}

export function heuristicExtraction(evidence: readonly Evidence[], directive: ResearchDirective): ExtractionResult {
  return { signals: extractSignalsHeuristically(evidence, directive), extractedBy: HEURISTIC_EXTRACTOR_ID, rejected: 0 };
}

export async function llmExtraction(
  provider: AIProvider,
  evidence: readonly Evidence[],
  directive: ResearchDirective,
): Promise<ExtractionResult> {
  const list = evidence.map((e) => ({ id: e.id, text: e.evidenceText, country: e.country, language: e.language }));
  const res = await provider.generate({
    agent: PAIN_MINER,
    system: SYSTEM,
    prompt: `Research objective: ${directive.objective}\nPersonas of interest: ${directive.personas.join(", ") || "unspecified"}\n\nEvidence:\n${JSON.stringify(list)}`,
    schema: SignalExtractionOutputSchema,
    maxOutputTokens: 4000,
  });
  const { kept, rejected } = sanitizeExtractedSignals(res.output.signals, new Set(evidence.map((e) => e.id)));
  return {
    signals: kept,
    extractedBy: `${provider.id}:${provider.model}`,
    rejected,
    llm: { usage: res.usage, costUsd: res.costUsd, provider: res.provider, model: res.model },
  };
}

export function estimateExtractionCost(provider: AIProvider | null, evidence: readonly Evidence[]): number {
  if (!provider || !provider.isLLM) return 0;
  const chars = evidence.reduce((n, e) => n + e.evidenceText.length + 60, 0) + SYSTEM.length;
  return provider.estimateCost(chars, 4000);
}
