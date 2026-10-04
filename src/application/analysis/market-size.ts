import type { AppContext } from "@/application/context";
import { requestReassessment } from "@/application/opportunity/reassess";
import type { StoredMarketEstimate } from "@/application/ports/repositories";
import { estimateMarketSize, type MarketInput } from "@/domain/analysis/market-size";
import { authorize } from "@/domain/auth/authorization";
import type { MarketSizeMethod } from "@/domain/opportunity/business-model";
import { DomainError } from "@/domain/shared/errors";

/**
 * QuantAnalyst: market size is computed only from explicit inputs (FACT with
 * evidence, or ASSUMPTION). AI never supplies the numbers.
 */
export async function estimateOpportunityMarket(
  ctx: AppContext,
  input: { opportunityId: string; method: MarketSizeMethod; inputs: Record<string, MarketInput>; currency: string; notes?: string },
): Promise<StoredMarketEstimate> {
  authorize(ctx.actor, "analysis.run");
  const linked = new Set(await ctx.repos.opportunities.listOpportunityEvidenceIds(input.opportunityId));
  for (const [k, v] of Object.entries(input.inputs)) {
    if (v.evidenceId && !linked.has(v.evidenceId)) throw new DomainError("EVIDENCE_INTEGRITY", `${k}: このOpportunityに紐づくEvidenceを指定してください`);
  }
  const result = estimateMarketSize(input.method, input.inputs, input.currency.toUpperCase());
  const saved = await ctx.repos.analysis.saveMarketEstimate(input.opportunityId, { ...result, notes: input.notes, createdBy: `user:${ctx.actor.userId}` });
  await ctx.repos.opportunities.updateAssessment(input.opportunityId, {
    marketSizeSummary: `${input.method}: ${saved.resultValue.toLocaleString()} ${saved.currency}/年（${saved.formula}・信頼度 ${saved.confidence}・仮定 ${saved.assumptions.length}件）`,
    fieldProvenance: { marketSizeSummary: "CALCULATION" },
  });
  await ctx.repos.ops.audit("analysis.market_size", "opportunity", input.opportunityId, { method: input.method, value: saved.resultValue });
  await requestReassessment(ctx, input.opportunityId, "market size estimated");
  return saved;
}
