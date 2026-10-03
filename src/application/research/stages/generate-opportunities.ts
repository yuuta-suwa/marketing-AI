import type { AgentRunner } from "@/application/agent-runner";
import type { AppContext } from "@/application/context";
import { assessConfidence, deriveScoreInputs } from "@/application/opportunity/assess";
import type { StoredCluster } from "@/application/ports/repositories";
import { JTBD_ANALYST, draftOpportunityHeuristically, draftOpportunityWithLLM, type ClusterContext } from "@/agents/jtbd-analyst";
import type { Evidence } from "@/domain/evidence/evidence";
import type { Opportunity, OpportunityDraft } from "@/domain/opportunity/opportunity";
import type { ResearchDirective } from "@/domain/research/directive";
import { computeOpportunityScore } from "@/domain/scoring/score";
import type { SignalType, StoredSignal } from "@/domain/signal/signal";
import type { SourceItem } from "@/domain/source/source-item";

export function dominantType(signals: readonly StoredSignal[]): SignalType {
  const counts = new Map<SignalType, number>();
  for (const s of signals) counts.set(s.signalType, (counts.get(s.signalType) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** Rank clusters for opportunity generation: support first, then pain. */
export function rankClusters(clusters: readonly StoredCluster[]): StoredCluster[] {
  return [...clusters].sort(
    (a, b) => b.signalCount * (b.painScore + 1) - a.signalCount * (a.painScore + 1) || a.id.localeCompare(b.id),
  );
}

/**
 * Opportunities are created only from clusters whose signals cite stored
 * evidence. Each one is scored and its evidence confidence computed
 * separately.
 */
export async function generateOpportunities(
  ctx: AppContext,
  runner: AgentRunner,
  input: {
    runId: string;
    directive: ResearchDirective;
    clusters: StoredCluster[];
    signals: Map<string, StoredSignal>;
    evidence: Map<string, Evidence>;
    sourceItems: Map<string, SourceItem>;
    qualityOf: (connectorId: string) => number;
  },
): Promise<{ opportunities: Opportunity[]; budgetStops: string[] }> {
  const { weights, id: scoringSettingsId } = await ctx.repos.ops.getScoringWeights();
  const now = ctx.clock.now().toISOString();
  const opportunities: Opportunity[] = [];
  const budgetStops: string[] = [];

  for (const cluster of rankClusters(input.clusters).slice(0, ctx.options.maxOpportunitiesPerRun)) {
    const members = cluster.signalIds.map((id) => input.signals.get(id)).filter((s): s is StoredSignal => Boolean(s));
    const evidence = [...new Set(members.flatMap((m) => m.evidenceIds))]
      .map((id) => input.evidence.get(id))
      .filter((e): e is Evidence => Boolean(e));
    if (members.length === 0 || evidence.length === 0) continue;

    const clusterCtx: ClusterContext = {
      id: cluster.id,
      name: cluster.name,
      dominantType: dominantType(members),
      signalCount: cluster.signalCount,
      sourceCount: cluster.sourceCount,
      paySignalScore: cluster.paySignalScore,
    };

    let draft: OpportunityDraft | null = null;
    if (ctx.ai?.isLLM) {
      const ai = ctx.ai;
      const outcome = await runner.run({
        agentName: JTBD_ANALYST,
        provider: ai.id,
        model: ai.model,
        input: { clusterId: cluster.id },
        estimateUsd: ai.estimateCost(evidence.reduce((n, e) => n + e.evidenceText.length, 2000), 2500),
        researchRunId: input.runId,
        execute: async () => {
          const r = await draftOpportunityWithLLM(ai, clusterCtx, members, evidence, input.directive);
          return { output: r.draft, ...r.llm };
        },
      });
      if (outcome.status === "SUCCEEDED") draft = outcome.output;
      if (outcome.status === "SKIPPED_BUDGET") budgetStops.push(`${JTBD_ANALYST}: ${outcome.reason}`);
    }
    if (!draft) {
      const outcome = await runner.run({
        agentName: `${JTBD_ANALYST}:heuristic`,
        provider: "heuristic",
        model: "jtbd-v1",
        input: { clusterId: cluster.id },
        estimateUsd: 0,
        researchRunId: input.runId,
        execute: async () => ({
          output: draftOpportunityHeuristically(clusterCtx, members, input.directive),
          usage: { inputTokens: 0, outputTokens: 0 },
          costUsd: 0,
          provider: "heuristic",
          model: "jtbd-v1",
        }),
      });
      if (outcome.status !== "SUCCEEDED") continue;
      draft = outcome.output;
    }

    const citedEvidence = draft.evidenceIds.map((id) => input.evidence.get(id)).filter((e): e is Evidence => Boolean(e));
    const confidence = assessConfidence(citedEvidence, input.sourceItems, input.qualityOf, now);
    const score = computeOpportunityScore(
      deriveScoreInputs(
        {
          signalCount: cluster.signalCount,
          painScore: cluster.painScore,
          paySignalScore: cluster.paySignalScore,
          momentum: cluster.momentum,
          datedObservations: citedEvidence.filter((e) => input.sourceItems.get(e.sourceItemId)?.publishedAt).length,
        },
        members,
      ),
      weights,
    );

    const opportunity = await ctx.repos.opportunities.createOpportunity({
      researchRunId: input.runId,
      clusterId: cluster.id,
      draft,
      confidence: confidence.level,
      scoreTotal: score.total,
      momentum: cluster.momentum,
    });
    await ctx.repos.opportunities.saveScore({
      opportunityId: opportunity.id,
      weights,
      score,
      confidence: confidence.level,
      confidenceBreakdown: confidence,
      scoredBy: scoringSettingsId ? `scoring_settings:${scoringSettingsId}` : "default-weights",
    });
    opportunities.push(opportunity);
  }
  return { opportunities, budgetStops };
}
