import { z } from "zod";
import { DomainError } from "../shared/errors";
import { round } from "../shared/math";

/**
 * CFO unit economics. Every number is tagged:
 *   FACT        — entered with an evidence id
 *   ASSUMPTION  — entered or defaulted without evidence
 *   CALCULATION — derived, with its formula
 */
export const CfoInputSchema = z.object({
  pricePerMonth: z.number().positive(),
  variableCostPerCustomerMonth: z.number().nonnegative(),
  aiCostPerCustomerMonth: z.number().nonnegative(),
  apiCostPerCustomerMonth: z.number().nonnegative(),
  cac: z.number().nonnegative(),
  monthlyChurn: z.number().gt(0).max(1),
  fixedCostPerMonth: z.number().nonnegative(),
  customersScenario: z.object({ conservative: z.number().int().nonnegative(), base: z.number().int().nonnegative(), optimistic: z.number().int().nonnegative() }),
});
export type CfoInputs = z.infer<typeof CfoInputSchema>;
export type InputProvenance = Partial<Record<keyof CfoInputs, { epistemic: "FACT" | "ASSUMPTION"; evidenceId?: string; note?: string }>>;

export type Metric = { value: number; unit: string; epistemic: "FACT" | "ASSUMPTION" | "CALCULATION"; formula?: string; evidenceId?: string; note?: string };

export type CfoAnalysis = {
  currency: string;
  metrics: Record<string, Metric>;
  warnings: string[];
};

export function analyzeUnitEconomics(raw: CfoInputs, provenance: InputProvenance, currency: string): CfoAnalysis {
  const i = CfoInputSchema.parse(raw);
  for (const [k, p] of Object.entries(provenance)) {
    if (p?.epistemic === "FACT" && !p.evidenceId) throw new DomainError("EVIDENCE_INTEGRITY", `${k} をFACTとする場合はEvidenceが必要です`);
  }
  const input = (k: keyof CfoInputs, unit: string): Metric => ({
    value: k === "customersScenario" ? NaN : (i[k] as number),
    unit,
    epistemic: provenance[k]?.epistemic ?? "ASSUMPTION",
    evidenceId: provenance[k]?.evidenceId,
    note: provenance[k]?.note,
  });
  const calc = (value: number, unit: string, formula: string): Metric => ({ value: round(value, 2), unit, epistemic: "CALCULATION", formula });

  const variable = i.variableCostPerCustomerMonth + i.aiCostPerCustomerMonth + i.apiCostPerCustomerMonth;
  const contribution = i.pricePerMonth - variable;
  const grossMargin = contribution / i.pricePerMonth;
  const lifetimeMonths = 1 / i.monthlyChurn;
  const ltv = contribution * lifetimeMonths;
  const payback = contribution > 0 ? i.cac / contribution : Infinity;
  const breakEven = contribution > 0 ? Math.ceil(i.fixedCostPerMonth / contribution) : Infinity;

  const metrics: Record<string, Metric> = {
    sellingPrice: input("pricePerMonth", `${currency}/customer/month`),
    variableCost: input("variableCostPerCustomerMonth", `${currency}/customer/month`),
    aiCost: input("aiCostPerCustomerMonth", `${currency}/customer/month`),
    apiCost: input("apiCostPerCustomerMonth", `${currency}/customer/month`),
    cac: input("cac", `${currency}/customer`),
    monthlyChurn: input("monthlyChurn", "ratio/month"),
    fixedCost: input("fixedCostPerMonth", `${currency}/month`),
    grossMargin: calc(grossMargin, "ratio", "(price − variable − AI − API) ÷ price"),
    ltv: calc(ltv, `${currency}/customer`, "(price − variable − AI − API) ÷ monthlyChurn"),
    ltvToCac: calc(i.cac > 0 ? ltv / i.cac : Infinity, "ratio", "LTV ÷ CAC"),
    paybackMonths: calc(payback, "months", "CAC ÷ monthly contribution"),
    breakEvenCustomers: calc(breakEven, "customers", "fixedCost ÷ monthly contribution"),
  };
  for (const [name, customers] of Object.entries(i.customersScenario)) {
    metrics[`monthlyRevenue_${name}`] = calc(customers * i.pricePerMonth, `${currency}/month`, `${name} customers × price`);
    metrics[`annualRevenue_${name}`] = calc(customers * i.pricePerMonth * 12, `${currency}/year`, `${name} customers × price × 12`);
    metrics[`monthlyProfit_${name}`] = calc(customers * contribution - i.fixedCostPerMonth, `${currency}/month`, `${name} × contribution − fixedCost`);
  }
  metrics.customersScenario = { ...input("customersScenario", "customers"), value: i.customersScenario.base, note: `conservative ${i.customersScenario.conservative} / base ${i.customersScenario.base} / optimistic ${i.customersScenario.optimistic}` };

  const warnings: string[] = [];
  if (grossMargin < 0.5) warnings.push("粗利率が50%未満（ソフトウェア事業としては低い）");
  if (contribution <= 0) warnings.push("1顧客あたりの限界利益がマイナス — 価格かコスト構造の見直しが必要");
  if (i.cac > 0 && ltv / i.cac < 3) warnings.push("LTV/CAC が 3 未満");
  if (payback > 12) warnings.push("CAC回収に12ヶ月超");
  const assumed = Object.keys(CfoInputSchema.shape).filter((k) => (provenance[k as keyof CfoInputs]?.epistemic ?? "ASSUMPTION") === "ASSUMPTION");
  if (assumed.length > 0) warnings.push(`仮定値のみの入力: ${assumed.join(", ")}（検証が必要）`);
  return { currency, metrics, warnings };
}

/** Starting assumptions per model type — clearly ASSUMPTION, meant to be overwritten. */
export function defaultCfoAssumptions(modelType: string): CfoInputs {
  const consumer = ["CONSUMER_APP", "ADVERTISING", "SUBSCRIPTION"].includes(modelType);
  return {
    pricePerMonth: consumer ? 980 : 30000,
    variableCostPerCustomerMonth: consumer ? 50 : 1500,
    aiCostPerCustomerMonth: consumer ? 60 : 1200,
    apiCostPerCustomerMonth: consumer ? 20 : 500,
    cac: consumer ? 3000 : 150000,
    monthlyChurn: consumer ? 0.08 : 0.03,
    fixedCostPerMonth: 1_500_000,
    customersScenario: consumer ? { conservative: 500, base: 3000, optimistic: 15000 } : { conservative: 20, base: 100, optimistic: 400 },
  };
}

export function monetizationScore(analysis: CfoAnalysis): number | null {
  const gm = analysis.metrics.grossMargin?.value;
  const ratio = analysis.metrics.ltvToCac?.value;
  if (gm === undefined || ratio === undefined || !Number.isFinite(gm)) return null;
  const r = Number.isFinite(ratio) ? Math.min(1, ratio / 5) : 1;
  return Math.max(0, Math.min(1, 0.5 * Math.max(0, gm) + 0.5 * r));
}
