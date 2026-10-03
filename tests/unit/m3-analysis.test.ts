import { describe, expect, it } from "vitest";
import { analyzeCompetitorsHeuristically } from "@/agents/competitor-analyst";
import { compareBusinessModels } from "@/domain/analysis/business-model";
import { analyzeUnitEconomics, defaultCfoAssumptions, monetizationScore } from "@/domain/analysis/cfo";
import { assertExperimentTransition } from "@/domain/analysis/experiment";
import { estimateMarketSize, marketSizeToScore } from "@/domain/analysis/market-size";
import { BUSINESS_MODEL_TYPES } from "@/domain/opportunity/business-model";
import type { Evidence } from "@/domain/evidence/evidence";
import type { StoredSignal } from "@/domain/signal/signal";

describe("market size (CALCULATION from explicit inputs)", () => {
  it("bottom-up multiplies inputs and keeps formula, inputs and assumptions", () => {
    const r = estimateMarketSize(
      "BOTTOM_UP",
      {
        customers: { value: 1_000_000, unit: "people", epistemic: "FACT", evidenceId: "e1" },
        purchasesPerYear: { value: 2, unit: "times/year", epistemic: "ASSUMPTION", note: "インタビュー前の仮置き" },
        pricePerPurchase: { value: 500, unit: "currency", epistemic: "ASSUMPTION" },
      },
      "JPY",
    );
    expect(r.resultValue).toBe(1_000_000_000);
    expect(r.formula).toBe("customers × purchasesPerYear × pricePerPurchase");
    expect(r.assumptions).toHaveLength(2);
    expect(r.sourceEvidenceIds).toEqual(["e1"]);
    expect(r.confidence).toBe("MEDIUM");
  });

  it("never fills a missing input and rejects FACT without evidence or ratios > 1", () => {
    expect(() => estimateMarketSize("TOP_DOWN", {}, "USD")).toThrow(/推測で補完しません/);
    expect(() =>
      estimateMarketSize("VALUE_THEORY", {
        customers: { value: 10, unit: "people", epistemic: "FACT" },
        valuePerCustomer: { value: 1, unit: "x", epistemic: "ASSUMPTION" },
        captureRate: { value: 0.1, unit: "ratio", epistemic: "ASSUMPTION" },
      }, "USD"),
    ).toThrow(/Evidence/);
    expect(() =>
      estimateMarketSize("TOP_DOWN", {
        totalMarket: { value: 1e9, unit: "c", epistemic: "ASSUMPTION" },
        segmentShare: { value: 5, unit: "ratio", epistemic: "ASSUMPTION" },
        reachableShare: { value: 0.1, unit: "ratio", epistemic: "ASSUMPTION" },
      }, "USD"),
    ).toThrow(/比率/);
  });

  it("maps size to a 0..1 score on a log scale", () => {
    expect(marketSizeToScore(100_000_000, "USD")).toBeGreaterThan(marketSizeToScore(1_000_000, "USD"));
    expect(marketSizeToScore(15_000_000_000, "JPY")).toBeCloseTo(marketSizeToScore(100_000_000, "USD"));
    expect(marketSizeToScore(0, "USD")).toBe(0);
  });
});

describe("business model comparison", () => {
  it("scores all 11 model types and does not default to SaaS for consumers", () => {
    const r = compareBusinessModels({ signalTypes: ["CAPACITY_GAP", "CAPACITY_GAP", "PAY_SIGNAL"], customerText: "旅行者", paySignalScore: 70, signalCount: 3 });
    expect(r.map((m) => m.modelType).sort()).toEqual([...BUSINESS_MODEL_TYPES].sort());
    expect(r[0].modelType).not.toBe("B2B_SAAS");
    expect(r[0].modelType).toBe("TRANSACTION_FEE");
  });

  it("favors B2B SaaS when customers are businesses with workarounds", () => {
    const r = compareBusinessModels({ signalTypes: ["WORKAROUND", "PAIN"], customerText: "中小企業の経理担当", paySignalScore: 20, signalCount: 2 });
    expect(r[0].modelType).toBe("B2B_SAAS");
  });
});

describe("CFO unit economics", () => {
  const inputs = { ...defaultCfoAssumptions("B2B_SAAS"), pricePerMonth: 30000, variableCostPerCustomerMonth: 3000, aiCostPerCustomerMonth: 2000, apiCostPerCustomerMonth: 1000, cac: 120000, monthlyChurn: 0.02, fixedCostPerMonth: 1_200_000 };

  it("computes margin, LTV, payback, break-even and scenarios with provenance", () => {
    const a = analyzeUnitEconomics(inputs, { pricePerMonth: { epistemic: "FACT", evidenceId: "e9" } }, "JPY");
    expect(a.metrics.grossMargin).toMatchObject({ value: 0.8, epistemic: "CALCULATION" });
    expect(a.metrics.ltv.value).toBe(1_200_000);
    expect(a.metrics.ltvToCac.value).toBe(10);
    expect(a.metrics.paybackMonths.value).toBe(5);
    expect(a.metrics.breakEvenCustomers.value).toBe(50);
    expect(a.metrics.sellingPrice.epistemic).toBe("FACT");
    expect(a.metrics.cac.epistemic).toBe("ASSUMPTION");
    expect(a.metrics.annualRevenue_base.value).toBe(100 * 30000 * 12);
    expect(monetizationScore(a)).toBeGreaterThan(0.8);
  });

  it("warns on negative contribution and refuses FACT without evidence", () => {
    const bad = analyzeUnitEconomics({ ...inputs, variableCostPerCustomerMonth: 40000 }, {}, "JPY");
    expect(bad.warnings.join()).toContain("マイナス");
    expect(bad.metrics.paybackMonths.value).toBe(Infinity);
    expect(() => analyzeUnitEconomics(inputs, { cac: { epistemic: "FACT" } }, "JPY")).toThrow(/Evidence/);
  });
});

describe("experiments", () => {
  it("follows PROPOSED → APPROVED → RUNNING → COMPLETED and requires a result", () => {
    expect(() => assertExperimentTransition("PROPOSED", "RUNNING", {})).toThrow(/Illegal/);
    expect(() => assertExperimentTransition("RUNNING", "COMPLETED", {})).toThrow(/結果/);
    expect(() => assertExperimentTransition("RUNNING", "COMPLETED", { resultSummary: "CVR 6%" })).not.toThrow();
    expect(() => assertExperimentTransition("COMPLETED", "RUNNING", {})).toThrow();
  });
});

describe("competitor heuristics", () => {
  it("only names alternatives present in evidence and cites them", () => {
    const evidence: Evidence[] = [
      { id: "e1", researchRunId: "r", sourceItemId: "s", evidenceText: "仕方なくタクシーを使っている", evidenceType: "QUOTE", retrievedAt: "", confidence: "MEDIUM" },
      { id: "e2", researchRunId: "r", sourceItemId: "s", evidenceText: "TripBookに乗り換えた", evidenceType: "QUOTE", retrievedAt: "", confidence: "MEDIUM" },
    ];
    const sig = (id: string, e: string, t: StoredSignal["signalType"]) => ({ id, evidenceIds: [e], signalType: t, problem: "p", priceIssue: false }) as unknown as StoredSignal;
    const r = analyzeCompetitorsHeuristically([sig("s1", "e1", "WORKAROUND"), sig("s2", "e2", "SWITCHING")], evidence);
    expect(r.find((c) => c.name === "タクシー")).toMatchObject({ competitorType: "ALTERNATIVE", sourceEvidenceIds: ["e1"] });
    expect(r.find((c) => c.name === "TripBook")).toMatchObject({ competitorType: "DIRECT", sourceEvidenceIds: ["e2"] });
    expect(r.every((c) => c.epistemicStatus === "INFERENCE")).toBe(true);
  });
});
