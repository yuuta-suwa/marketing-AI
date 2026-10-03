import type { AnalysisRepository, StoredCompetitor } from "@/application/ports/repositories";
import { assertExperimentTransition } from "@/domain/analysis/experiment";
import type { Actor } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";
import type { Clock } from "@/lib/clock";
import { newId } from "@/lib/ids";
import type { MemoryDatabase } from "./memory-db";

function strip<T extends { organizationId: string }>(row: T): Omit<T, "organizationId"> {
  const { organizationId: _o, ...rest } = row;
  void _o;
  return rest;
}

export function createMemoryAnalysisRepository(db: MemoryDatabase, actor: Actor, clock: Clock): AnalysisRepository {
  const org = actor.organizationId;
  const now = () => clock.now().toISOString();
  const ownOpp = (id: string) => {
    const o = db.opportunities.get(id);
    if (!o || o.organizationId !== org) throw new DomainError("NOT_FOUND", "opportunity not found");
  };
  const checkEvidence = (ids: string[]) => {
    for (const id of ids) {
      const e = db.evidence.get(id);
      if (!e || e.organizationId !== org) throw new DomainError("EVIDENCE_INTEGRITY", `unknown evidence id ${id}`);
    }
  };
  const competitorRows = (opportunityId: string) =>
    [...db.competitors.values()].filter((c) => c.organizationId === org && c.opportunityId === opportunityId);

  return {
    async replaceCompetitors(opportunityId, rows, options = {}) {
      ownOpp(opportunityId);
      for (const r of rows) checkEvidence(r.sourceEvidenceIds);
      for (const c of competitorRows(opportunityId)) if (!(options.keepManual && c.manual)) db.competitors.delete(c.id);
      for (const r of rows) {
        const row = { ...r, id: newId(), organizationId: org, opportunityId, createdAt: now() };
        db.competitors.set(row.id, row);
      }
      return competitorRows(opportunityId).map((c) => strip(c) as StoredCompetitor);
    },
    async addCompetitor(opportunityId, r) {
      ownOpp(opportunityId);
      checkEvidence(r.sourceEvidenceIds);
      const row = { ...r, id: newId(), organizationId: org, opportunityId, createdAt: now(), manual: true };
      db.competitors.set(row.id, row);
      const { manual: _m, ...rest } = strip(row);
      void _m;
      return rest;
    },
    async listCompetitors(opportunityId) {
      return competitorRows(opportunityId).map((c) => {
        const { manual: _m, ...rest } = strip(c);
        void _m;
        return rest;
      });
    },
    async saveMarketEstimate(opportunityId, e) {
      ownOpp(opportunityId);
      checkEvidence(e.sourceEvidenceIds);
      const row = { ...e, id: newId(), organizationId: org, opportunityId, createdAt: now() };
      db.marketEstimates.set(row.id, row);
      return strip(row);
    },
    async listMarketEstimates(opportunityId) {
      return [...db.marketEstimates.values()]
        .filter((m) => m.organizationId === org && m.opportunityId === opportunityId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(strip);
    },
    async replaceBusinessModels(opportunityId, rows) {
      ownOpp(opportunityId);
      if (rows.filter((r) => r.isPrimary).length > 1) throw new DomainError("VALIDATION", "only one primary business model");
      for (const b of [...db.businessModels.values()]) if (b.organizationId === org && b.opportunityId === opportunityId) db.businessModels.delete(b.id);
      for (const r of rows) {
        const row = { ...r, id: newId(), organizationId: org, opportunityId, createdAt: now() };
        db.businessModels.set(row.id, row);
      }
      return this.listBusinessModels(opportunityId);
    },
    async listBusinessModels(opportunityId) {
      return [...db.businessModels.values()]
        .filter((b) => b.organizationId === org && b.opportunityId === opportunityId)
        .sort((a, b) => b.fitScore - a.fitScore)
        .map(strip);
    },
    async setUnitEconomics(id, unitEconomics) {
      const b = db.businessModels.get(id);
      if (!b || b.organizationId !== org) throw new DomainError("NOT_FOUND", "business model not found");
      db.businessModels.set(id, { ...b, unitEconomics });
    },
    async createExperiment(opportunityId, draft) {
      ownOpp(opportunityId);
      const row = { ...draft, id: newId(), organizationId: org, opportunityId, status: "PROPOSED" as const, createdAt: now() };
      db.experiments.set(row.id, row);
      return strip(row);
    },
    async getExperiment(id) {
      const e = db.experiments.get(id);
      return e && e.organizationId === org ? strip(e) : null;
    },
    async listExperiments(filter) {
      return [...db.experiments.values()]
        .filter((e) => e.organizationId === org && (!filter.opportunityId || e.opportunityId === filter.opportunityId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, filter.limit ?? 100)
        .map(strip);
    },
    async updateExperiment(id, patch) {
      const e = db.experiments.get(id);
      if (!e || e.organizationId !== org) throw new DomainError("NOT_FOUND", "experiment not found");
      const next = {
        ...e,
        status: patch.status ?? e.status,
        resultSummary: patch.resultSummary ?? e.resultSummary,
        decision: patch.decision ?? e.decision,
        approvedBy: patch.approve ? actor.userId : e.approvedBy,
        decidedBy: patch.decide ? actor.userId : e.decidedBy,
      };
      assertExperimentTransition(e.status, next.status, { resultSummary: next.resultSummary });
      if (next.status === "APPROVED" && !next.approvedBy) throw new DomainError("FORBIDDEN", "approval must record the approving user");
      db.experiments.set(id, next);
      return strip(next);
    },
  };
}
