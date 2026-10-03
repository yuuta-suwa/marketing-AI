import { z } from "zod";
import { type ConfidenceLevel } from "../shared/confidence";
import { DomainError } from "../shared/errors";
import { round } from "../shared/math";
import type { MarketSizeMethod } from "../opportunity/business-model";

/**
 * Market sizing is a CALCULATION over explicit inputs. Each input declares
 * where it came from; only inputs backed by evidence count as FACT. The
 * system never invents an input — a missing input is an error, not a guess.
 */
export const MarketInputSchema = z.object({
  value: z.number().finite().nonnegative(),
  unit: z.string().min(1).max(40),
  epistemic: z.enum(["FACT", "ASSUMPTION"]),
  evidenceId: z.string().optional(),
  note: z.string().max(500).optional(),
});
export type MarketInput = z.infer<typeof MarketInputSchema>;

export const METHOD_INPUTS: Record<MarketSizeMethod, Array<{ key: string; label: string; unit: string }>> = {
  TOP_DOWN: [
    { key: "totalMarket", label: "上位市場規模（年間）", unit: "currency/year" },
    { key: "segmentShare", label: "対象セグメント比率", unit: "ratio" },
    { key: "reachableShare", label: "到達可能比率", unit: "ratio" },
  ],
  BOTTOM_UP: [
    { key: "customers", label: "対象顧客数", unit: "people" },
    { key: "purchasesPerYear", label: "年間購入回数", unit: "times/year" },
    { key: "pricePerPurchase", label: "1回あたり単価", unit: "currency" },
  ],
  VALUE_THEORY: [
    { key: "customers", label: "対象顧客数", unit: "people" },
    { key: "valuePerCustomer", label: "顧客1人あたり年間創出価値", unit: "currency/year" },
    { key: "captureRate", label: "価値の獲得率", unit: "ratio" },
  ],
};

const FORMULA: Record<MarketSizeMethod, string> = {
  TOP_DOWN: "totalMarket × segmentShare × reachableShare",
  BOTTOM_UP: "customers × purchasesPerYear × pricePerPurchase",
  VALUE_THEORY: "customers × valuePerCustomer × captureRate",
};

export type MarketEstimateResult = {
  method: MarketSizeMethod;
  formula: string;
  inputs: Record<string, MarketInput>;
  assumptions: string[];
  resultValue: number;
  resultUnit: string;
  currency: string;
  sourceEvidenceIds: string[];
  confidence: ConfidenceLevel;
};

export function estimateMarketSize(
  method: MarketSizeMethod,
  inputs: Record<string, MarketInput>,
  currency: string,
): MarketEstimateResult {
  const required = METHOD_INPUTS[method];
  for (const { key, unit } of required) {
    const input = inputs[key];
    if (!input) throw new DomainError("VALIDATION", `入力「${key}」がありません（推測で補完しません）`);
    MarketInputSchema.parse(input);
    if (unit === "ratio" && input.value > 1) throw new DomainError("VALIDATION", `${key} は0〜1の比率で入力してください`);
    if (input.epistemic === "FACT" && !input.evidenceId) {
      throw new DomainError("EVIDENCE_INTEGRITY", `${key} をFACTとする場合はEvidenceが必要です`);
    }
  }
  const resultValue = required.reduce((acc, { key }) => acc * inputs[key].value, 1);
  const facts = required.filter(({ key }) => inputs[key].epistemic === "FACT").length;
  const confidence: ConfidenceLevel = facts === required.length ? "HIGH" : facts >= 1 ? "MEDIUM" : "LOW";
  return {
    method,
    formula: FORMULA[method],
    inputs: Object.fromEntries(required.map(({ key }) => [key, inputs[key]])),
    assumptions: required
      .filter(({ key }) => inputs[key].epistemic === "ASSUMPTION")
      .map(({ key, label }) => `${label}（${key}）= ${inputs[key].value} ${inputs[key].unit}${inputs[key].note ? ` — ${inputs[key].note}` : ""}`),
    resultValue: round(resultValue, 2),
    resultUnit: "currency/year",
    currency,
    sourceEvidenceIds: required.map(({ key }) => inputs[key].evidenceId).filter((x): x is string => Boolean(x)),
    confidence,
  };
}

/** Annual market (USD-equivalent) → 0..1 for scoring. 1 USD = fxJpy JPY is an ASSUMPTION. */
export function marketSizeToScore(value: number, currency: string, fxJpy = 150): number {
  const usd = currency.toUpperCase() === "JPY" ? value / fxJpy : value;
  if (usd <= 0) return 0;
  // $1M → 0.3, $100M → 0.7, $10B → 1.0 (log scale)
  return Math.max(0, Math.min(1, (Math.log10(usd) - 4.5) / 5.5));
}
