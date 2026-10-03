import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalysisRepository, StoredBusinessModel, StoredCompetitor, StoredMarketEstimate } from "@/application/ports/repositories";
import type { Experiment } from "@/domain/analysis/experiment";
import type { Actor } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come from PostgREST untyped */
type Row = Record<string, any>;
type PgResult = { data: any; error: { message: string; code?: string } | null };

function must(res: PgResult, what: string): any {
  if (res.error) {
    if (res.error.code === "42501") throw new DomainError("FORBIDDEN", `${what}: ${res.error.message}`);
    if (res.error.code === "23514") throw new DomainError("ILLEGAL_TRANSITION", `${what}: ${res.error.message}`);
    if (res.error.code === "23503") throw new DomainError("EVIDENCE_INTEGRITY", `${what}: ${res.error.message}`);
    throw new Error(`${what}: ${res.error.message}`);
  }
  if (res.data === null || res.data === undefined) throw new DomainError("NOT_FOUND", `${what}: not found`);
  return res.data;
}

const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

const mapCompetitor = (r: Row): StoredCompetitor => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  name: r.name,
  competitorType: r.competitor_type,
  url: opt(r.url),
  pricing: opt(r.pricing),
  positioning: opt(r.positioning),
  customerComplaints: opt(r.customer_complaints),
  strengths: opt(r.strengths),
  weaknesses: opt(r.weaknesses),
  marketGap: opt(r.market_gap),
  epistemicStatus: r.epistemic_status,
  sourceEvidenceIds: r.source_evidence_ids ?? [],
  createdAt: r.created_at,
});

const competitorRow = (org: string, opportunityId: string, c: Omit<StoredCompetitor, "id" | "createdAt" | "opportunityId">) => ({
  organization_id: org,
  opportunity_id: opportunityId,
  name: c.name,
  competitor_type: c.competitorType,
  url: c.url ?? null,
  pricing: c.pricing ?? null,
  positioning: c.positioning ?? null,
  customer_complaints: c.customerComplaints ?? null,
  strengths: c.strengths ?? null,
  weaknesses: c.weaknesses ?? null,
  market_gap: c.marketGap ?? null,
  epistemic_status: c.epistemicStatus,
  source_evidence_ids: c.sourceEvidenceIds,
});

const mapEstimate = (r: Row): StoredMarketEstimate => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  method: r.method,
  formula: r.formula,
  inputs: r.inputs,
  assumptions: r.assumptions,
  resultValue: Number(r.result_value),
  resultUnit: r.result_unit,
  currency: r.currency,
  sourceEvidenceIds: r.source_evidence_ids ?? [],
  confidence: r.confidence,
  notes: opt(r.notes),
  createdBy: r.created_by,
  createdAt: r.created_at,
});

const mapModel = (r: Row): StoredBusinessModel => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  modelType: r.model_type,
  description: opt(r.description),
  fitScore: r.fit_score ?? 0,
  rationale: opt(r.rationale),
  risks: opt(r.risks),
  isPrimary: r.is_primary,
  unitEconomics: r.unit_economics ?? {},
  createdBy: r.created_by,
  createdAt: r.created_at,
});

const mapExperiment = (r: Row): Experiment => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  title: r.title,
  hypothesis: r.hypothesis,
  method: r.method ?? "",
  metric: r.metric ?? "",
  target: r.target ?? "",
  budgetUsd: Number(r.budget_usd ?? 0),
  deadline: r.deadline ?? "",
  killCriteria: opt(r.kill_criteria),
  status: r.status,
  resultSummary: opt(r.result_summary),
  decision: opt(r.decision),
  approvedBy: opt(r.approved_by),
  decidedBy: opt(r.decided_by),
  createdAt: r.created_at,
});

export function createSupabaseAnalysisRepository(db: SupabaseClient, actor: Actor): AnalysisRepository {
  const org = actor.organizationId;
  return {
    async replaceCompetitors(opportunityId, rows, options = {}) {
      // Manual (user-entered) competitors are ASSUMPTION/FACT rows created via addCompetitor; analyst rows are INFERENCE.
      let del = db.from("competitors").delete().eq("organization_id", org).eq("opportunity_id", opportunityId);
      if (options.keepManual) del = del.eq("epistemic_status", "INFERENCE");
      must(await del.select("id"), "clear competitors");
      if (rows.length > 0) must(await db.from("competitors").insert(rows.map((r) => competitorRow(org, opportunityId, r))).select("id"), "insert competitors");
      return this.listCompetitors(opportunityId);
    },
    async addCompetitor(opportunityId, r) {
      return mapCompetitor(must(await db.from("competitors").insert(competitorRow(org, opportunityId, r)).select().single(), "add competitor"));
    },
    async listCompetitors(opportunityId) {
      return (must(await db.from("competitors").select().eq("organization_id", org).eq("opportunity_id", opportunityId).order("created_at"), "list competitors") as Row[]).map(mapCompetitor);
    },
    async saveMarketEstimate(opportunityId, e) {
      return mapEstimate(
        must(
          await db
            .from("market_estimates")
            .insert({
              organization_id: org,
              opportunity_id: opportunityId,
              method: e.method,
              formula: e.formula,
              inputs: e.inputs,
              assumptions: e.assumptions,
              result_value: e.resultValue,
              result_unit: e.resultUnit,
              currency: e.currency,
              source_evidence_ids: e.sourceEvidenceIds,
              confidence: e.confidence,
              notes: e.notes ?? null,
              created_by: e.createdBy,
            })
            .select()
            .single(),
          "save market estimate",
        ),
      );
    },
    async listMarketEstimates(opportunityId) {
      return (must(await db.from("market_estimates").select().eq("organization_id", org).eq("opportunity_id", opportunityId).order("created_at", { ascending: false }), "list estimates") as Row[]).map(mapEstimate);
    },
    async replaceBusinessModels(opportunityId, rows) {
      must(await db.from("business_models").delete().eq("organization_id", org).eq("opportunity_id", opportunityId).select("id"), "clear business models");
      if (rows.length > 0) {
        must(
          await db
            .from("business_models")
            .insert(
              rows.map((r) => ({
                organization_id: org,
                opportunity_id: opportunityId,
                model_type: r.modelType,
                description: r.description ?? null,
                fit_score: r.fitScore,
                rationale: r.rationale ?? null,
                risks: r.risks ?? null,
                is_primary: r.isPrimary,
                unit_economics: r.unitEconomics ?? {},
                created_by: r.createdBy,
              })),
            )
            .select("id"),
          "insert business models",
        );
      }
      return this.listBusinessModels(opportunityId);
    },
    async listBusinessModels(opportunityId) {
      return (must(await db.from("business_models").select().eq("organization_id", org).eq("opportunity_id", opportunityId).order("fit_score", { ascending: false }), "list business models") as Row[]).map(mapModel);
    },
    async setUnitEconomics(id, unitEconomics) {
      must(await db.from("business_models").update({ unit_economics: unitEconomics }).eq("organization_id", org).eq("id", id).select("id").single(), "set unit economics");
    },
    async createExperiment(opportunityId, d) {
      return mapExperiment(
        must(
          await db
            .from("experiments")
            .insert({
              organization_id: org,
              opportunity_id: opportunityId,
              title: d.title,
              hypothesis: d.hypothesis,
              method: d.method,
              metric: d.metric,
              target: d.target,
              budget_usd: d.budgetUsd,
              deadline: d.deadline,
              kill_criteria: d.killCriteria ?? null,
              success_criteria: d.target,
              created_by: actor.userId,
            })
            .select()
            .single(),
          "create experiment",
        ),
      );
    },
    async getExperiment(id) {
      const res = await db.from("experiments").select().eq("organization_id", org).eq("id", id).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return res.data ? mapExperiment(res.data) : null;
    },
    async listExperiments(filter) {
      let q = db.from("experiments").select().eq("organization_id", org).order("created_at", { ascending: false }).limit(filter.limit ?? 100);
      if (filter.opportunityId) q = q.eq("opportunity_id", filter.opportunityId);
      return (must(await q, "list experiments") as Row[]).map(mapExperiment);
    },
    async updateExperiment(id, patch) {
      const update: Row = {};
      if (patch.status) update.status = patch.status;
      if (patch.resultSummary !== undefined) update.result_summary = patch.resultSummary;
      if (patch.decision) update.decision = patch.decision;
      if (patch.approve) update.approved_by = actor.userId;
      if (patch.decide) update.decided_by = actor.userId;
      return mapExperiment(must(await db.from("experiments").update(update).eq("organization_id", org).eq("id", id).select().single(), "update experiment"));
    },
  };
}
