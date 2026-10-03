import type { AppContext } from "@/application/context";
import type { CfoAnalysis } from "@/domain/analysis/cfo";
import type { OpportunityDossier } from "@/domain/executive/dossier";
import { DomainError } from "@/domain/shared/errors";

export async function buildDossier(ctx: AppContext, opportunityId: string): Promise<OpportunityDossier> {
  const repo = ctx.repos.opportunities;
  const opportunity = await repo.getOpportunity(opportunityId);
  if (!opportunity) throw new DomainError("NOT_FOUND", "Opportunity not found");
  const evidenceIds = await repo.listOpportunityEvidenceIds(opportunityId);
  const [evidence, score, redTeam, competitors, estimates, models, experiments, cluster] = await Promise.all([
    ctx.repos.evidence.listEvidence({ ids: evidenceIds }),
    repo.latestScore(opportunityId),
    repo.listRedTeam(opportunityId),
    ctx.repos.analysis.listCompetitors(opportunityId),
    ctx.repos.analysis.listMarketEstimates(opportunityId),
    ctx.repos.analysis.listBusinessModels(opportunityId),
    ctx.repos.analysis.listExperiments({ opportunityId }),
    ctx.repos.signals.getCluster(opportunity.clusterId),
  ]);
  const signals = cluster ? await ctx.repos.signals.listSignals({ ids: cluster.signalIds }) : [];
  const primary = models.find((m) => m.isPrimary) ?? null;
  return {
    opportunity,
    evidence,
    score: score?.score ?? null,
    confidence: score?.confidenceBreakdown ?? null,
    redTeam: redTeam[0] ?? null,
    competitors: competitors.map((c) => ({ name: c.name, competitorType: c.competitorType, epistemicStatus: c.epistemicStatus })),
    marketEstimate: estimates[0] ?? null,
    primaryModel: primary ? { modelType: primary.modelType, fitScore: primary.fitScore, rationale: primary.rationale } : null,
    cfo: primary?.unitEconomics?.metrics ? (primary.unitEconomics as CfoAnalysis) : null,
    experiments,
    signalTypes: signals.map((s) => s.signalType),
  };
}
