import type { AppContext } from "@/application/context";
import { requestReassessment } from "@/application/opportunity/reassess";
import type { StoredBusinessModel } from "@/application/ports/repositories";
import { BUSINESS_MODEL_LABEL_JA, compareBusinessModels } from "@/domain/analysis/business-model";
import { analyzeUnitEconomics, defaultCfoAssumptions, type CfoInputs, type InputProvenance } from "@/domain/analysis/cfo";
import { authorize } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";

/** BusinessModelAgent: compares all 11 model types (HYPOTHESIS ranking). */
export async function compareOpportunityBusinessModels(ctx: AppContext, opportunityId: string): Promise<StoredBusinessModel[]> {
  authorize(ctx.actor, "analysis.run");
  const opp = await ctx.repos.opportunities.getOpportunity(opportunityId);
  if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
  const cluster = await ctx.repos.signals.getCluster(opp.clusterId);
  const signals = cluster ? await ctx.repos.signals.listSignals({ ids: cluster.signalIds }) : [];
  const ranked = compareBusinessModels({
    signalTypes: signals.map((s) => s.signalType),
    customerText: `${opp.customer ?? ""} ${opp.pain}`,
    paySignalScore: cluster?.paySignalScore ?? 0,
    signalCount: signals.length,
  });
  const previous = (await ctx.repos.analysis.listBusinessModels(opportunityId)).find((m) => m.isPrimary);
  const saved = await ctx.repos.analysis.replaceBusinessModels(
    opportunityId,
    ranked.map((r, i) => ({
      modelType: r.modelType,
      description: BUSINESS_MODEL_LABEL_JA[r.modelType],
      fitScore: r.fitScore,
      rationale: r.rationale,
      risks: r.risks,
      isPrimary: i === 0,
      // Keep CFO work if the primary model did not change.
      unitEconomics: i === 0 && previous?.modelType === r.modelType ? previous.unitEconomics : {},
      createdBy: "heuristic:business-model-v1",
    })),
  );
  const top = saved.filter((m) => m.isPrimary)[0];
  await ctx.repos.opportunities.updateAssessment(opportunityId, {
    revenueModel: `${BUSINESS_MODEL_LABEL_JA[top.modelType]}（適合 ${top.fitScore}）— ${top.rationale}。次点: ${saved.slice(1, 3).map((m) => BUSINESS_MODEL_LABEL_JA[m.modelType]).join("、")}`,
    fieldProvenance: { revenueModel: "HYPOTHESIS" },
  });
  await ctx.repos.ops.audit("analysis.business_models", "opportunity", opportunityId, { primary: top.modelType });
  return saved;
}

/** CFOAgent: unit economics for the primary model; numbers tagged FACT/ASSUMPTION/CALCULATION. */
export async function runCfoAnalysis(
  ctx: AppContext,
  input: { opportunityId: string; inputs?: Partial<CfoInputs>; provenance?: InputProvenance; currency?: string },
) {
  authorize(ctx.actor, "analysis.run");
  let models = await ctx.repos.analysis.listBusinessModels(input.opportunityId);
  if (models.length === 0) models = await compareOpportunityBusinessModels(ctx, input.opportunityId);
  const primary = models.find((m) => m.isPrimary) ?? models[0];
  const linked = new Set(await ctx.repos.opportunities.listOpportunityEvidenceIds(input.opportunityId));
  for (const [k, p] of Object.entries(input.provenance ?? {})) {
    if (p?.evidenceId && !linked.has(p.evidenceId)) throw new DomainError("EVIDENCE_INTEGRITY", `${k}: このOpportunityに紐づくEvidenceを指定してください`);
  }
  const previous = primary.unitEconomics?.inputs;
  const inputs: CfoInputs = { ...defaultCfoAssumptions(primary.modelType), ...(previous ?? {}), ...(input.inputs ?? {}) };
  const provenance: InputProvenance = { ...(primary.unitEconomics?.provenance ?? {}), ...(input.provenance ?? {}) };
  const analysis = analyzeUnitEconomics(inputs, provenance, (input.currency ?? primary.unitEconomics?.currency ?? "JPY").toUpperCase());
  await ctx.repos.analysis.setUnitEconomics(primary.id, { ...analysis, inputs, provenance });
  await ctx.repos.ops.audit("analysis.cfo", "opportunity", input.opportunityId, { model: primary.modelType, warnings: analysis.warnings.length });
  await requestReassessment(ctx, input.opportunityId, "cfo analysis");
  return { model: primary, analysis };
}
