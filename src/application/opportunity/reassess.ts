import type { AppContext } from "@/application/context";
import { assessConfidence, deriveScoreInputs } from "@/application/opportunity/assess";
import { monetizationScore, type CfoAnalysis } from "@/domain/analysis/cfo";
import { marketSizeToScore } from "@/domain/analysis/market-size";
import type { Opportunity } from "@/domain/opportunity/opportunity";
import { computeOpportunityScore } from "@/domain/scoring/score";
import { DomainError } from "@/domain/shared/errors";

/**
 * Recomputes score and evidence confidence from everything now linked to
 * the opportunity: cluster signals, all evidence (incl. additional research),
 * the latest market estimate and the primary model's CFO analysis.
 */
export async function reassessOpportunity(ctx: AppContext, opportunityId: string, reason: string): Promise<Opportunity> {
  const repo = ctx.repos.opportunities;
  const opp = await repo.getOpportunity(opportunityId);
  if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
  const cluster = await ctx.repos.signals.getCluster(opp.clusterId);
  const evidenceIds = await repo.listOpportunityEvidenceIds(opportunityId);
  const evidence = await ctx.repos.evidence.listEvidence({ ids: evidenceIds });
  const evidenceSet = new Set(evidenceIds);

  // Signals: the cluster's plus any signal citing newly linked evidence.
  const runIds = [...new Set(evidence.map((e) => e.researchRunId))];
  const runSignals = (await Promise.all(runIds.map((runId) => ctx.repos.signals.listSignals({ runId })))).flat();
  const clusterIds = new Set(cluster?.signalIds ?? []);
  const signals = runSignals.filter((s) => clusterIds.has(s.id) || s.evidenceIds.some((id) => evidenceSet.has(id)));

  const sourceItems = new Map((await Promise.all(runIds.map((r) => ctx.repos.evidence.listSourceItems(r)))).flat().map((s) => [s.id, s]));
  const qualityOf = (id: string) => ctx.connectors.get(id)?.sourceQuality ?? 0.3;
  const confidence = assessConfidence(evidence, sourceItems, qualityOf, ctx.clock.now().toISOString());

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const inputs = deriveScoreInputs(
    {
      signalCount: signals.length,
      painScore: avg(signals.map((s) => s.urgencyScore)),
      paySignalScore: avg(signals.map((s) => s.willingnessToPayScore)),
      momentum: opp.momentum,
      datedObservations: evidence.filter((e) => sourceItems.get(e.sourceItemId)?.publishedAt).length,
    },
    signals,
  );

  const [estimates, models] = await Promise.all([
    ctx.repos.analysis.listMarketEstimates(opportunityId),
    ctx.repos.analysis.listBusinessModels(opportunityId),
  ]);
  const estimate = estimates[0];
  if (estimate) {
    inputs.marketSize = {
      value: marketSizeToScore(estimate.resultValue, estimate.currency),
      rationale: `${estimate.method}: ${estimate.resultValue.toLocaleString()} ${estimate.currency}/年（信頼度 ${estimate.confidence}、JPY換算は1USD=150JPYを仮定）`,
      epistemic: "CALCULATION",
    };
  }
  const primary = models.find((m) => m.isPrimary);
  const cfo = primary?.unitEconomics?.metrics ? (primary.unitEconomics as CfoAnalysis) : null;
  const monetization = cfo ? monetizationScore(cfo) : null;
  if (monetization !== null) {
    inputs.monetizationQuality = {
      value: monetization,
      rationale: `粗利率 ${Math.round((cfo!.metrics.grossMargin.value ?? 0) * 100)}% / LTV÷CAC ${cfo!.metrics.ltvToCac.value}（仮定入力に基づく計算）`,
      epistemic: "CALCULATION",
    };
  }

  const { weights, id: settingsId } = await ctx.repos.ops.getScoringWeights();
  const score = computeOpportunityScore(inputs, weights);
  await repo.saveScore({
    opportunityId,
    weights,
    score,
    confidence: confidence.level,
    confidenceBreakdown: confidence,
    scoredBy: `${settingsId ? `scoring_settings:${settingsId}` : "default-weights"} · ${reason}`,
  });
  const updated = await repo.updateAssessment(opportunityId, { scoreTotal: score.total, confidence: confidence.level });
  await ctx.repos.ops.audit("opportunity.reassessed", "opportunity", opportunityId, {
    reason,
    scoreBefore: opp.scoreTotal,
    scoreAfter: score.total,
    confidenceBefore: opp.confidence,
    confidenceAfter: confidence.level,
  });
  return updated;
}

/**
 * Request path: system scores are worker-controlled, so user-triggered
 * analyses enqueue a reassessment instead of writing scores themselves.
 */
export async function requestReassessment(ctx: AppContext, opportunityId: string, reason: string): Promise<void> {
  await ctx.repos.jobs.enqueue({
    jobType: "OPPORTUNITY_REASSESSMENT",
    idempotencyKey: `reassess:${opportunityId}:${ctx.clock.now().getTime()}:${Math.random().toString(36).slice(2, 8)}`,
    opportunityId,
    payload: { reason: reason.slice(0, 200) },
    priority: 50,
  });
}
