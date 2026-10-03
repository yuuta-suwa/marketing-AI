import type { Evidence } from "@/domain/evidence/evidence";
import type { ResearchDirective } from "@/domain/research/directive";
import type { MarketSignal } from "@/domain/signal/signal";
import { FREQUENCY_CUES, INTENSITY_CUES, SIGNAL_PRIORITY, detectSignalTypes } from "./cues";

export const HEURISTIC_EXTRACTOR_ID = "heuristic:signal-v1";

/**
 * Deterministic signal extraction. The `problem` is the verbatim evidence
 * excerpt (no paraphrase), each signal cites exactly the evidence it came
 * from, and confidence is LOW because a single excerpt is weak evidence.
 */
export function extractSignalsHeuristically(
  evidence: readonly Evidence[],
  directive: Pick<ResearchDirective, "categories" | "personas">,
): MarketSignal[] {
  const out: MarketSignal[] = [];
  for (const e of evidence) {
    const types = detectSignalTypes(e.evidenceText);
    if (types.length === 0) continue;
    const primary = SIGNAL_PRIORITY.find((t) => types.includes(t)) ?? types[0];
    const intense = INTENSITY_CUES.test(e.evidenceText);
    const frequent = FREQUENCY_CUES.test(e.evidenceText);
    const urgency = Math.min(100, 40 + (intense ? 25 : 0) + (frequent ? 15 : 0) + (types.length - 1) * 5);
    out.push({
      problem: e.evidenceText.slice(0, 2000),
      persona: directive.personas[0],
      urgencyScore: urgency,
      frequencySignal: frequent ? 70 : 30,
      willingnessToPayScore: types.includes("PAY_SIGNAL") ? 75 : types.includes("PRICE_GAP") ? 35 : 15,
      switchingIntentScore: types.includes("SWITCHING") ? 70 : 10,
      trustIssue: types.includes("TRUST_GAP"),
      priceIssue: types.includes("PRICE_GAP"),
      accessIssue: types.includes("ACCESS_GAP") || types.includes("CAPACITY_GAP"),
      category: directive.categories[0],
      location: e.country,
      signalType: primary,
      evidenceIds: [e.id],
      confidence: "LOW",
    });
  }
  return out;
}
