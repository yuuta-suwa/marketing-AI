import { describe, expect, it } from "vitest";
import { sanitizeExtractedSignals } from "@/agents/pain-miner";
import { extractSignalsHeuristically } from "@/agents/heuristics/signal-heuristics";
import { assertVerbatim, requireEvidenceRefs, splitIntoExcerpts, validateEvidenceRefs } from "@/domain/evidence/evidence";
import { assertClaimIsGrounded } from "@/domain/shared/epistemic";
import { MarketSignalSchema, type MarketSignal } from "@/domain/signal/signal";
import type { Evidence } from "@/domain/evidence/evidence";

const signal = (over: Partial<MarketSignal> = {}): MarketSignal => ({
  problem: "空港の案内が分かりにくい",
  urgencyScore: 50,
  frequencySignal: 30,
  willingnessToPayScore: 10,
  switchingIntentScore: 10,
  trustIssue: false,
  priceIssue: false,
  accessIssue: false,
  signalType: "INFORMATION_GAP",
  evidenceIds: ["e1"],
  confidence: "LOW",
  ...over,
});

describe("evidence integrity", () => {
  it("accepts verbatim excerpts and rejects paraphrases", () => {
    expect(() => assertVerbatim("移動が分かりにくい", "空港からの移動が分かりにくい。")).not.toThrow();
    expect(() => assertVerbatim("移動が不便", "空港からの移動が分かりにくい。")).toThrow(/verbatim/);
    expect(() => assertVerbatim("", "abc")).toThrow();
  });

  it("splits into excerpts that remain substrings of the body", () => {
    const body = "空港が遠い。案内が分かりにくい！\nThe map is confusing. It is fine.";
    const parts = splitIntoExcerpts(body);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const p of parts) expect(body.includes(p)).toBe(true);
  });

  it("detects invented evidence ids", () => {
    const known = new Set(["e1", "e2"]);
    expect(validateEvidenceRefs(["e1", "zzz"], known)).toEqual({ valid: ["e1"], invalid: ["zzz"] });
    expect(() => requireEvidenceRefs(["zzz"], known)).toThrow(/unknown/);
    expect(() => requireEvidenceRefs([], known)).toThrow(/at least one/);
  });

  it("FACT claims must cite evidence; CALCULATION must show a formula", () => {
    expect(() => assertClaimIsGrounded({ value: "x", epistemic: "FACT" })).toThrow();
    expect(() => assertClaimIsGrounded({ value: 1, epistemic: "CALCULATION" })).toThrow();
    expect(() => assertClaimIsGrounded({ value: 1, epistemic: "CALCULATION", formula: "a*b" })).not.toThrow();
  });
});

describe("signal validation", () => {
  it("validates the signal schema", () => {
    expect(MarketSignalSchema.safeParse(signal()).success).toBe(true);
    expect(MarketSignalSchema.safeParse(signal({ urgencyScore: 101 })).success).toBe(false);
    expect(MarketSignalSchema.safeParse(signal({ evidenceIds: [] })).success).toBe(false);
    expect(MarketSignalSchema.safeParse({ ...signal(), signalType: "MADE_UP" }).success).toBe(false);
  });

  it("drops LLM signals that cite unknown evidence ids", () => {
    const r = sanitizeExtractedSignals([signal(), signal({ evidenceIds: ["invented"] }), signal({ evidenceIds: ["e1", "invented"] })], new Set(["e1"]));
    expect(r.kept).toHaveLength(1);
    expect(r.rejected).toBe(2);
  });

  it("heuristic extraction quotes evidence verbatim and cites it", () => {
    const evidence: Evidence[] = [
      { id: "e1", researchRunId: "r", sourceItemId: "s", evidenceText: "有料でもいいので荷物を預かってほしい", evidenceType: "QUOTE", retrievedAt: "", confidence: "MEDIUM" },
      { id: "e2", researchRunId: "r", sourceItemId: "s", evidenceText: "景色がきれいでした", evidenceType: "QUOTE", retrievedAt: "", confidence: "MEDIUM" },
    ];
    const out = extractSignalsHeuristically(evidence, { categories: ["travel"], personas: [] });
    expect(out).toHaveLength(1);
    expect(out[0].problem).toBe(evidence[0].evidenceText);
    expect(out[0].evidenceIds).toEqual(["e1"]);
    expect(out[0].signalType).toBe("PAY_SIGNAL");
    expect(out[0].confidence).toBe("LOW");
  });
});
