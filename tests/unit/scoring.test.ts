import { describe, expect, it } from "vitest";
import { computeConfidence, interpretScoreAndConfidence } from "@/domain/scoring/confidence";
import { DEFAULT_SCORING_WEIGHTS, SCORE_CRITERIA, ScoringWeightsSchema } from "@/domain/scoring/criteria";
import { computeOpportunityScore, UNASSESSED_PRIOR } from "@/domain/scoring/score";

describe("opportunity score", () => {
  it("default weights total exactly 100", () => {
    expect(Object.values(DEFAULT_SCORING_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(ScoringWeightsSchema.safeParse(DEFAULT_SCORING_WEIGHTS).success).toBe(true);
  });

  it("all criteria at 1.0 scores 100 and at 0 scores 0", () => {
    const all = (v: number) =>
      Object.fromEntries(SCORE_CRITERIA.map((c) => [c, { value: v, rationale: "t", epistemic: "INFERENCE" as const }]));
    expect(computeOpportunityScore(all(1), DEFAULT_SCORING_WEIGHTS).total).toBe(100);
    expect(computeOpportunityScore(all(0), DEFAULT_SCORING_WEIGHTS).total).toBe(0);
  });

  it("weights each criterion and reports unassessed criteria as ASSUMPTION", () => {
    const s = computeOpportunityScore(
      { painSeverity: { value: 1, rationale: "x", epistemic: "INFERENCE" } },
      DEFAULT_SCORING_WEIGHTS,
    );
    expect(s.components.painSeverity.points).toBe(15);
    expect(s.components.marketSize.assumed).toBe(true);
    expect(s.components.marketSize.epistemic).toBe("ASSUMPTION");
    expect(s.components.marketSize.points).toBe(10 * UNASSESSED_PRIOR);
    expect(s.coverage).toBe(0.15);
    expect(s.missing).toHaveLength(13);
    expect(s.total).toBe(15 + 85 * UNASSESSED_PRIOR);
  });

  it("clamps out-of-range values", () => {
    const s = computeOpportunityScore(
      { painSeverity: { value: 4, rationale: "x", epistemic: "INFERENCE" } },
      DEFAULT_SCORING_WEIGHTS,
    );
    expect(s.components.painSeverity.appliedValue).toBe(1);
  });

  it("rejects weights that do not sum to 100", () => {
    expect(() => computeOpportunityScore({}, { ...DEFAULT_SCORING_WEIGHTS, painSeverity: 50 })).toThrow();
  });

  it("supports custom weights", () => {
    const weights = { ...DEFAULT_SCORING_WEIGHTS, painSeverity: 25, socialValue: 0, strategicFit: 0, timeToRevenue: 0, defensibility: 0 };
    weights.frequency += 100 - Object.values(weights).reduce((a, b) => a + b, 0);
    const s = computeOpportunityScore({ painSeverity: { value: 1, rationale: "", epistemic: "INFERENCE" } }, weights);
    expect(s.components.painSeverity.points).toBe(25);
  });
});

describe("evidence confidence (independent of score)", () => {
  const base = {
    sourceQualities: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
    distinctSources: 6,
    distinctChannels: 4,
    observedAt: Array(6).fill("2026-09-20T00:00:00Z"),
    evidenceCount: 30,
    contradictions: 0,
    now: "2026-10-01T00:00:00Z",
  };

  it("is HIGH with diverse, fresh, high-quality evidence", () => {
    expect(computeConfidence(base).level).toBe("HIGH");
  });

  it("is LOW with fewer than 3 evidence items regardless of quality", () => {
    const c = computeConfidence({ ...base, evidenceCount: 2 });
    expect(c.level).toBe("LOW");
    expect(c.caps).toContain("evidence_count<3");
  });

  it("caps a single channel (e.g. one SNS) at MEDIUM", () => {
    const c = computeConfidence({ ...base, distinctChannels: 1 });
    expect(c.level).not.toBe("HIGH");
  });

  it("caps contradicted evidence at MEDIUM", () => {
    expect(computeConfidence({ ...base, contradictions: 3 }).level).not.toBe("HIGH");
  });

  it("score and confidence are reported separately", () => {
    expect(interpretScoreAndConfidence(91, "LOW")).toBe("非常に魅力的だが証拠不足");
    expect(interpretScoreAndConfidence(91, "HIGH")).toBe("有望・証拠も十分");
  });
});
