import type { AppContext } from "@/application/context";
import { assertExperimentTransition, ExperimentDraftSchema, type Experiment, type ExperimentDecision, type ExperimentDraft } from "@/domain/analysis/experiment";
import { authorize } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";

export async function createExperiment(ctx: AppContext, opportunityId: string, draft: ExperimentDraft): Promise<Experiment> {
  authorize(ctx.actor, "opportunity.update");
  const opp = await ctx.repos.opportunities.getOpportunity(opportunityId);
  if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
  const exp = await ctx.repos.analysis.createExperiment(opportunityId, ExperimentDraftSchema.parse(draft));
  await ctx.repos.ops.audit("experiment.created", "opportunity", opportunityId, { experimentId: exp.id });
  return exp;
}

/** Proposal → approval (human) → running → completed with result + decision. */
export async function advanceExperiment(
  ctx: AppContext,
  experimentId: string,
  action: { type: "approve" } | { type: "start" } | { type: "cancel" } | { type: "complete"; resultSummary: string; decision: ExperimentDecision },
): Promise<Experiment> {
  authorize(ctx.actor, action.type === "approve" || action.type === "complete" ? "opportunity.decide" : "opportunity.update");
  const exp = await ctx.repos.analysis.getExperiment(experimentId);
  if (!exp) throw new DomainError("NOT_FOUND", "Experiment not found");
  const to = { approve: "APPROVED", start: "RUNNING", cancel: "CANCELLED", complete: "COMPLETED" } as const;
  const resultSummary = action.type === "complete" ? action.resultSummary : undefined;
  assertExperimentTransition(exp.status, to[action.type], { resultSummary });
  const updated = await ctx.repos.analysis.updateExperiment(experimentId, {
    status: to[action.type],
    approve: action.type === "approve",
    ...(action.type === "complete" ? { resultSummary: action.resultSummary, decision: action.decision, decide: true } : {}),
  });
  await ctx.repos.ops.audit(`experiment.${action.type}`, "opportunity", exp.opportunityId, { experimentId });
  return updated;
}
