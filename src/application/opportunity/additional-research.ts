import type { AppContext } from "@/application/context";
import { createResearch, toManualItems } from "@/application/research/create-research";
import { dispatchResearch, type ResearchDispatch } from "@/application/research/dispatch";
import { authorize } from "@/domain/auth/authorization";
import type { ResearchRequest } from "@/domain/research/directive";
import type { ResearchRunType } from "@/domain/research/run";
import { DomainError } from "@/domain/shared/errors";

export const ADDITIONAL_RESEARCH_TYPES = [
  "ADDITIONAL",
  "OVERSEAS_COMPARISON",
  "COMPETITOR",
  "WILLINGNESS_TO_PAY",
  "MARKET_SIZE",
  "REGULATION",
  "PRICING",
  "DISTRIBUTION",
] as const satisfies readonly ResearchRunType[];
export type AdditionalResearchType = (typeof ADDITIONAL_RESEARCH_TYPES)[number];

const FOCUS: Record<AdditionalResearchType, string> = {
  ADDITIONAL: "追加の顧客の声・不満",
  OVERSEAS_COMPARISON: "海外での同様の課題と解決事例",
  COMPETITOR: "既存の競合サービス・代替手段とその不満点",
  WILLINGNESS_TO_PAY: "支払意思・価格への言及",
  MARKET_SIZE: "市場規模推定に使える公的統計・取引量",
  REGULATION: "関連する法規制・制度・許認可",
  PRICING: "既存サービスの価格・料金への不満",
  DISTRIBUTION: "顧客が情報収集・購入するチャネル",
};

/**
 * Each additional investigation is a new ResearchRun linked to the
 * opportunity (research_runs.opportunity_id) and to the originating run.
 */
export async function startAdditionalResearch(
  ctx: AppContext,
  input: {
    opportunityId: string;
    type: AdditionalResearchType;
    note?: string;
    manualItems?: ResearchRequest["manualItems"];
  },
): Promise<ResearchDispatch> {
  authorize(ctx.actor, "analysis.run");
  const opp = await ctx.repos.opportunities.getOpportunity(input.opportunityId);
  if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
  const overseas = input.type === "OVERSEAS_COMPARISON";
  const request: ResearchRequest = {
    input: `${opp.title} — ${FOCUS[input.type]}${overseas ? "（海外 global）" : ""}。課題: ${opp.pain.slice(0, 300)}${
      input.note ? `。補足: ${input.note}` : ""
    }`.slice(0, 4000),
    manualItems: input.manualItems,
  };
  const { run } = await createResearch(ctx, request, {
    runType: input.type,
    parentRunId: opp.researchRunId,
    opportunityId: opp.id,
  });
  // Queued: the worker runs the stages; results are incorporated into the opportunity.
  return dispatchResearch(ctx, run.id, { manualItems: toManualItems(input.manualItems) });
}
