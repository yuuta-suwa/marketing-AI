import type { AppContext } from "@/application/context";
import { analyzeCompetitors } from "@/application/analysis/competitors";
import { reassessOpportunity } from "@/application/opportunity/reassess";
import { signalText } from "@/application/research/stages/cluster-signals";
import { cosineSimilarity } from "@/domain/cluster/similarity";
import type { ResearchRun } from "@/domain/research/run";
import type { SignalType } from "@/domain/signal/signal";

/** Signal types that are relevant by definition for a focused run type. */
const FOCUS_TYPES: Partial<Record<ResearchRun["runType"], SignalType[]>> = {
  WILLINGNESS_TO_PAY: ["PAY_SIGNAL", "PRICE_GAP"],
  PRICING: ["PRICE_GAP", "PAY_SIGNAL"],
  COMPETITOR: ["WORKAROUND", "SWITCHING"],
  REGULATION: ["REGULATION_GAP"],
  DISTRIBUTION: ["DISTRIBUTION_GAP", "ACCESS_GAP"],
};

export const RELATED_SIMILARITY = 0.2;

/**
 * Closes the loop Opportunity → ResearchRun → New Evidence → Opportunity Update.
 * Evidence from the additional run is linked only when its signal is
 * semantically related to the opportunity (or matches the run's focus);
 * statistics found by a MARKET_SIZE run are linked as candidate inputs.
 * Then the opportunity is re-scored and its confidence recomputed.
 */
export async function incorporateAdditionalResearch(ctx: AppContext, run: ResearchRun): Promise<{ linked: number }> {
  if (!run.opportunityId) return { linked: 0 };
  const opp = await ctx.repos.opportunities.getOpportunity(run.opportunityId);
  if (!opp) return { linked: 0 };
  const signals = await ctx.repos.signals.listSignals({ runId: run.id });
  const evidence = await ctx.repos.evidence.listEvidence({ runId: run.id });

  const toLink = new Set<string>();
  if (signals.length > 0) {
    let provider = ctx.embeddings;
    let embedded;
    try {
      embedded = await provider.embed([`${opp.title}\n${opp.pain}\n${opp.desiredOutcome ?? ""}`, ...signals.map(signalText)]);
    } catch {
      provider = ctx.fallbackEmbeddings;
      embedded = await provider.embed([`${opp.title}\n${opp.pain}`, ...signals.map(signalText)]);
    }
    if (embedded.costUsd > 0) {
      await ctx.repos.ops.recordCost({ category: "EMBEDDING", provider: provider.id, model: provider.model, amountUsd: embedded.costUsd, researchRunId: run.id });
    }
    const [oppVec, ...vecs] = embedded.vectors;
    const focus = FOCUS_TYPES[run.runType] ?? [];
    signals.forEach((s, i) => {
      if (focus.includes(s.signalType) || cosineSimilarity(oppVec, vecs[i]) >= RELATED_SIMILARITY) {
        for (const id of s.evidenceIds) toLink.add(id);
      }
    });
  }
  if (run.runType === "MARKET_SIZE") for (const e of evidence) if (e.evidenceType === "STATISTIC") toLink.add(e.id);

  const linked = await ctx.repos.opportunities.linkEvidence(opp.id, [...toLink], run.id);
  if (run.runType === "COMPETITOR") await analyzeCompetitors(ctx, opp.id);
  await reassessOpportunity(ctx, opp.id, `additional research ${run.runType}`);
  await ctx.repos.ops.audit("opportunity.updated_from_research", "opportunity", opp.id, { runId: run.id, linked });
  return { linked };
}
