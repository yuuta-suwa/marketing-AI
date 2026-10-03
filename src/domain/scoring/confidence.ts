import { type ConfidenceLevel, confidenceFromRatio, minConfidence } from "../shared/confidence";
import { clamp01, round } from "../shared/math";

export type ConfidenceInputs = {
  /** Per-evidence source quality, 0..1 (official stats high, anonymous posts low). */
  sourceQualities: number[];
  /** Distinct source identities backing the claim. */
  distinctSources: number;
  /** Distinct connector / channel types (cross-source agreement). */
  distinctChannels: number;
  /** Evidence timestamps (ISO). */
  observedAt: string[];
  evidenceCount: number;
  /** Count of evidence explicitly contradicting the claim. */
  contradictions: number;
  now?: string;
  freshnessDays?: number;
};

export type ConfidenceBreakdown = {
  sourceQuality: number;
  sourceDiversity: number;
  freshness: number;
  evidenceVolume: number;
  crossSourceAgreement: number;
  contradictionPenalty: number;
  composite: number;
  level: ConfidenceLevel;
  caps: string[];
};

const W = {
  sourceQuality: 0.25,
  sourceDiversity: 0.2,
  freshness: 0.15,
  evidenceVolume: 0.2,
  crossSourceAgreement: 0.2,
};

/**
 * Evidence confidence, independent from the opportunity score.
 * Hard caps make sure we never claim more than the data supports:
 *   - fewer than 3 evidence items  -> LOW
 *   - a single channel (e.g. one SNS) -> at most MEDIUM
 *   - contradictions present          -> at most MEDIUM
 */
export function computeConfidence(input: ConfidenceInputs): ConfidenceBreakdown {
  const sourceQuality =
    input.sourceQualities.length === 0
      ? 0
      : clamp01(input.sourceQualities.reduce((a, b) => a + b, 0) / input.sourceQualities.length);
  const sourceDiversity = clamp01(Math.log2(1 + Math.max(0, input.distinctSources)) / Math.log2(1 + 8));
  const ref = input.now ? Date.parse(input.now) : Date.now();
  const window = (input.freshnessDays ?? 180) * 86_400_000;
  const dated = input.observedAt.map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t));
  const freshness = dated.length === 0 ? 0.3 : dated.filter((t) => ref - t <= window).length / dated.length;
  const evidenceVolume = clamp01(Math.log2(1 + Math.max(0, input.evidenceCount)) / Math.log2(1 + 30));
  const crossSourceAgreement = clamp01((Math.max(1, input.distinctChannels) - 1) / 3);
  const contradictionPenalty = clamp01(input.contradictions / Math.max(1, input.evidenceCount)) * 0.5;

  const composite = clamp01(
    W.sourceQuality * sourceQuality +
      W.sourceDiversity * sourceDiversity +
      W.freshness * freshness +
      W.evidenceVolume * evidenceVolume +
      W.crossSourceAgreement * crossSourceAgreement -
      contradictionPenalty,
  );

  let level = confidenceFromRatio(composite);
  const caps: string[] = [];
  if (input.evidenceCount < 3) {
    level = "LOW";
    caps.push("evidence_count<3");
  }
  if (input.distinctChannels <= 1) {
    const capped = minConfidence(level, "MEDIUM");
    if (capped !== level) caps.push("single_channel");
    level = capped;
  }
  if (input.contradictions > 0) {
    const capped = minConfidence(level, "MEDIUM");
    if (capped !== level) caps.push("contradictions");
    level = capped;
  }

  return {
    sourceQuality: round(sourceQuality, 3),
    sourceDiversity: round(sourceDiversity, 3),
    freshness: round(freshness, 3),
    evidenceVolume: round(evidenceVolume, 3),
    crossSourceAgreement: round(crossSourceAgreement, 3),
    contradictionPenalty: round(contradictionPenalty, 3),
    composite: round(composite, 3),
    level,
    caps,
  };
}

/** Plain-language reading of score vs confidence for the mobile card. */
export function interpretScoreAndConfidence(score: number, confidence: ConfidenceLevel): string {
  const attractive = score >= 70;
  if (attractive && confidence === "LOW") return "非常に魅力的だが証拠不足";
  if (attractive && confidence === "MEDIUM") return "有望・追加検証を推奨";
  if (attractive && confidence === "HIGH") return "有望・証拠も十分";
  if (score >= 50) return confidence === "LOW" ? "中程度・証拠不足" : "中程度の機会";
  return confidence === "HIGH" ? "魅力は低い（証拠あり）" : "魅力は低い";
}
