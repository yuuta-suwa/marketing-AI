import { describe, expect, it } from "vitest";
import { PERSPECTIVES, runAdvisorCouncil } from "@/domain/executive/advisor-council";
import { detectChanges } from "@/domain/executive/change-detection";
import { buildClaudeCodePrompt } from "@/domain/executive/claude-code-export";
import type { OpportunityDossier } from "@/domain/executive/dossier";
import { parseFridayIntent } from "@/domain/executive/friday-intent";
import { generatePocSpec, POC_SPEC_SECTIONS } from "@/domain/executive/poc-spec";
import { nextForwardStatus } from "@/domain/opportunity/status";

const dossier = (status: OpportunityDossier["opportunity"]["status"] = "VALIDATED"): OpportunityDossier => ({
  opportunity: {
    id: "o1", organizationId: "org", researchRunId: "r", clusterId: "c", title: "荷物預かり", pain: "コインロッカーが足りない",
    customer: "訪日旅行者", status, confidence: "MEDIUM", scoreTotal: 72, momentum: 30, fieldProvenance: { customer: "INFERENCE" },
    createdAt: "", updatedAt: "", killCriteria: "支払意思が30%未満なら撤退", nextExperiment: "LPで事前登録",
  },
  evidence: [{ id: "e1", researchRunId: "r", sourceItemId: "s", evidenceText: "コインロッカーが足りない", evidenceType: "QUOTE", retrievedAt: "", confidence: "MEDIUM", sourceUrl: "https://ex.com" }],
  score: null,
  confidence: null,
  redTeam: null,
  competitors: [],
  marketEstimate: null,
  primaryModel: { modelType: "TRANSACTION_FEE", fitScore: 70 },
  cfo: null,
  experiments: [],
  signalTypes: ["SHORTAGE"],
});

describe("advisor council", () => {
  it("returns all 8 perspectives and FRIDAY's integration", () => {
    const r = runAdvisorCouncil(dossier());
    expect(r.perspectives.map((p) => p.perspective)).toEqual(PERSPECTIVES.map((p) => p.key));
    expect(r.consensus.length).toBeGreaterThan(0);
    expect(r.unansweredQuestions.length).toBeGreaterThan(0);
    expect(r.criticalAssumptions.length).toBeGreaterThan(0);
    expect(r.requiredEvidence.length).toBeGreaterThan(0);
    expect(r.perspectives.every((p) => p.epistemic === "INFERENCE")).toBe(true);
  });

  it("uses analytic lenses, not impersonated people; quotes only come from customer evidence", () => {
    const d = dossier();
    const text = JSON.stringify(runAdvisorCouncil(d));
    for (const name of ["Jobs", "Bezos", "Musk", "Buffett", "孫正義", "松下", "稲盛"]) expect(text).not.toContain(name);
    for (const m of text.matchAll(/「([^」]*)」/g)) expect(d.opportunity.pain + d.evidence.map((e) => e.evidenceText).join()).toContain(m[1]);
  });
});

describe("PoC spec and Claude Code export", () => {
  it("contains every required section and is DRAFT until PoC approval", () => {
    const spec = generatePocSpec(dossier("EXPERIMENT_APPROVED"));
    for (const s of POC_SPEC_SECTIONS) expect(spec.markdown).toContain(`## ${s}`);
    expect(spec.approved).toBe(false);
    expect(spec.markdown).toContain("DRAFT");
    expect(spec.sections.Evidence).toContain("[evidence:e1]");
  });

  it("export is refused before approval and complete after", () => {
    expect(() => buildClaudeCodePrompt(generatePocSpec(dossier("POC_PROPOSED")), { opportunityId: "o1", generatedAt: "t" })).toThrow(/PoC承認/);
    const prompt = buildClaudeCodePrompt(generatePocSpec(dossier("POC_APPROVED")), { opportunityId: "o1", generatedAt: "t" });
    expect(prompt).toContain("# CLAUDE_CODE_BUILD_PROMPT");
    expect(prompt).toContain("## Acceptance Criteria");
    expect(prompt).toContain("Row Level Security");
  });
});

describe("notification logic", () => {
  const base = { checkedAt: "t1" };
  it("first observation is a baseline (no notification)", () => {
    expect(detectChanges("x", undefined, { ...base, score: 90 })).toEqual([]);
  });
  it("notifies only meaningful changes", () => {
    expect(detectChanges("x", { ...base, score: 60 }, { ...base, score: 65 })).toEqual([]);
    expect(detectChanges("x", { ...base, score: 60 }, { ...base, score: 75 }).map((e) => e.kind)).toEqual(["SCORE_JUMP"]);
    expect(detectChanges("x", { ...base, confidence: "LOW" }, { ...base, confidence: "MEDIUM" })[0].kind).toBe("CONFIDENCE_CHANGE");
    expect(detectChanges("x", { ...base, competitorNames: ["A"] }, { ...base, competitorNames: ["A", "B"] })[0]).toMatchObject({ kind: "NEW_COMPETITOR", body: "B" });
    expect(detectChanges("x", { ...base, matchingSignals: 2 }, { ...base, matchingSignals: 4 })).toEqual([]);
    expect(detectChanges("x", { ...base, matchingSignals: 2 }, { ...base, matchingSignals: 6 })[0].kind).toBe("SIGNAL_SURGE");
    expect(detectChanges("x", { ...base }, { ...base, regulationSignals: 1 })[0].kind).toBe("REGULATION_CHANGE");
    expect(detectChanges("x", { ...base }, { ...base, priceSignals: 3 })[0].kind).toBe("PRICE_SHIFT");
  });
});

describe("FRIDAY intents", () => {
  it.each([
    ["日本の旅行市場の不満を調べて", "RESEARCH"],
    ["競合調査して", "DEEP_RESEARCH"],
    ["海外比較", "DEEP_RESEARCH"],
    ["Red Teamお願い", "RED_TEAM"],
    ["顧問会議を開いて", "COUNCIL"],
    ["承認 理由: 支払意思あり", "APPROVE"],
    ["保留で", "HOLD"],
    ["却下", "REJECT"],
    ["ウォッチして", "WATCH"],
    ["PoC仕様書を作って", "POC_SPEC"],
    ["Claude Codeにエクスポート", "EXPORT"],
    ["今日のブリーフ", "BRIEF"],
    ["どう思う？", "CONSULT"],
    ["help", "HELP"],
  ])("%s → %s", (text, kind) => {
    expect(parseFridayIntent(text).kind).toBe(kind);
  });

  it("extracts the decision reason, and the reason never changes the intent", () => {
    expect(parseFridayIntent("承認 理由: 支払意思を確認済み")).toMatchObject({ kind: "APPROVE", reason: "支払意思を確認済み" });
    expect(parseFridayIntent("承認 理由: CEOとしてPoC開始を承認")).toMatchObject({ kind: "APPROVE", reason: "CEOとしてPoC開始を承認" });
    expect(parseFridayIntent("保留 理由: 競合調査とRed Teamの結果待ち")).toMatchObject({ kind: "HOLD" });
  });

  it("knows the next gate", () => {
    expect(nextForwardStatus("DISCOVERED")).toBe("VALIDATED");
    expect(nextForwardStatus("POC_PROPOSED")).toBe("POC_APPROVED");
    expect(nextForwardStatus("REJECTED")).toBeNull();
  });
});
