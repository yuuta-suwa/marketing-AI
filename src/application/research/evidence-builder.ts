import { splitIntoExcerpts, type EvidenceType, type NewEvidence } from "@/domain/evidence/evidence";
import type { ConfidenceLevel } from "@/domain/shared/confidence";
import type { SourceItem } from "@/domain/source/source-item";
import { hasAnyCue } from "@/agents/heuristics/cues";

const TYPE_BY_SOURCE: Record<string, EvidenceType> = {
  REVIEW: "REVIEW",
  POST: "POST",
  WEB: "ARTICLE",
  ARTICLE: "ARTICLE",
  STATISTIC: "STATISTIC",
  OFFICIAL: "OFFICIAL_RECORD",
  MANUAL: "QUOTE",
};

function confidenceFor(quality: number): ConfidenceLevel {
  if (quality >= 0.8) return "HIGH";
  if (quality >= 0.5) return "MEDIUM";
  return "LOW";
}

/**
 * Turns source items into verbatim evidence excerpts. Customer-voice items
 * keep only sentences with a need/pain cue; statistical items are kept whole
 * (they document the existence of official data, not a complaint).
 */
export function buildEvidence(
  items: readonly SourceItem[],
  qualityOf: (connectorId: string) => number,
  maxPerItem = 5,
): NewEvidence[] {
  const out: NewEvidence[] = [];
  for (const item of items) {
    const evidenceType = TYPE_BY_SOURCE[item.sourceType] ?? "QUOTE";
    const confidence = confidenceFor(qualityOf(item.connectorId));
    const base = {
      researchRunId: item.researchRunId,
      sourceItemId: item.id,
      sourceUrl: item.sourceUrl,
      evidenceType,
      retrievedAt: item.retrievedAt,
      confidence,
      language: item.language,
      country: item.country,
    };
    if (evidenceType === "STATISTIC" || evidenceType === "OFFICIAL_RECORD") {
      out.push({ ...base, evidenceText: item.body.slice(0, 4000) });
      continue;
    }
    // Identical sentences in one item are one piece of evidence (DB: unique per source item + text).
    const excerpts = [...new Set(splitIntoExcerpts(item.body).filter(hasAnyCue))].slice(0, maxPerItem);
    for (const text of excerpts) out.push({ ...base, evidenceText: text });
  }
  return out;
}
