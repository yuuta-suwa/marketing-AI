import { AgentRunner } from "@/application/agent-runner";
import { createBudgetTracker } from "@/application/budget";
import type { AppContext } from "@/application/context";
import type { StoredRedTeamReview } from "@/application/ports/repositories";
import { RED_TEAM, redTeamHeuristically, redTeamWithLLM, type RedTeamContext } from "@/agents/red-team";
import { authorize } from "@/domain/auth/authorization";
import type { RedTeamReview } from "@/domain/opportunity/red-team";
import { DomainError } from "@/domain/shared/errors";

/** Runs RedTeamAgent on one opportunity and stores the review. */
export async function runRedTeam(ctx: AppContext, opportunityId: string): Promise<StoredRedTeamReview> {
  authorize(ctx.actor, "analysis.run");
  const opportunity = await ctx.repos.opportunities.getOpportunity(opportunityId);
  if (!opportunity) throw new DomainError("NOT_FOUND", "Opportunity not found");
  const evidenceIds = await ctx.repos.opportunities.listOpportunityEvidenceIds(opportunityId);
  const evidence = await ctx.repos.evidence.listEvidence({ ids: evidenceIds });
  const cluster = await ctx.repos.signals.getCluster(opportunity.clusterId);
  const signals = cluster ? await ctx.repos.signals.listSignals({ ids: cluster.signalIds }) : [];

  const redCtx: RedTeamContext = {
    opportunity,
    evidence,
    signalTypes: signals.map((s) => s.signalType),
    sourceCount: cluster?.sourceCount ?? 1,
    confidence: opportunity.confidence,
  };

  const runner = new AgentRunner({
    ops: ctx.repos.ops,
    budget: await createBudgetTracker(ctx),
    logger: ctx.logger.child({ agent: RED_TEAM }),
    maxCallsPerAgent: 1,
  });

  let review: RedTeamReview | null = null;
  let createdBy = "heuristic:red-team-v1";
  if (ctx.ai?.isLLM) {
    const ai = ctx.ai;
    const outcome = await runner.run({
      agentName: RED_TEAM,
      provider: ai.id,
      model: ai.model,
      input: { opportunityId },
      estimateUsd: ai.estimateCost(4000 + evidence.reduce((n, e) => n + e.evidenceText.length, 0), 3000),
      opportunityId,
      execute: async () => {
        const r = await redTeamWithLLM(ai, redCtx);
        return { output: r.review, ...r.llm };
      },
    });
    if (outcome.status === "SUCCEEDED") {
      review = outcome.output;
      createdBy = `${ai.id}:${ai.model}`;
    }
  }
  if (!review) {
    const outcome = await runner.run({
      agentName: `${RED_TEAM}:heuristic`,
      provider: "heuristic",
      model: "red-team-v1",
      input: { opportunityId },
      estimateUsd: 0,
      opportunityId,
      execute: async () => ({
        output: redTeamHeuristically(redCtx),
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        provider: "heuristic",
        model: "red-team-v1",
      }),
    });
    if (outcome.status !== "SUCCEEDED") {
      throw new DomainError("CONFLICT", `Red Team failed: ${"error" in outcome ? outcome.error : outcome.reason}`);
    }
    review = outcome.output;
  }

  const saved = await ctx.repos.opportunities.saveRedTeam({ ...review, opportunityId, createdBy });
  await ctx.repos.ops.audit("opportunity.red_team", "opportunity", opportunityId, { verdict: saved.verdict });
  return saved;
}
