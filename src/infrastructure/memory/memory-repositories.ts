import type {
  AgentRunRecord,
  EvidenceRepository,
  NewCluster,
  NewSignal,
  OpportunityRepository,
  OpsRepository,
  Repositories,
  ResearchRepository,
  SignalRepository,
  StoredCluster,
} from "@/application/ports/repositories";
import type { Actor } from "@/domain/auth/authorization";
import { assertVerbatim } from "@/domain/evidence/evidence";
import { assertOpportunityTransition, HUMAN_GATED_STATUSES } from "@/domain/opportunity/status";
import { assertRunTransition } from "@/domain/research/run-state-machine";
import { DEFAULT_SCORING_WEIGHTS } from "@/domain/scoring/criteria";
import { DomainError } from "@/domain/shared/errors";
import type { Clock } from "@/lib/clock";
import { newId } from "@/lib/ids";
import type { MemoryDatabase } from "./memory-db";

const DEFAULT_BUDGET = { perRunUsd: 1, dailyUsd: 5, monthlyUsd: 50 };

function strip<T extends { organizationId: string }>(row: T): Omit<T, "organizationId"> {
  const { organizationId: _org, ...rest } = row;
  void _org;
  return rest;
}

export function createMemoryRepositories(db: MemoryDatabase, actor: Actor, clock: Clock): Repositories {
  const org = actor.organizationId;
  const now = () => clock.now().toISOString();
  const mine = <T extends { organizationId: string }>(row: T | undefined): T | undefined =>
    row && row.organizationId === org ? row : undefined;

  const research: ResearchRepository = {
    async createDirective({ directive, parser }) {
      const row = { ...directive, id: newId(), organizationId: org, parser, createdBy: actor.userId, createdAt: now() };
      db.directives.set(row.id, row);
      return row;
    },
    async getDirective(id) {
      return mine(db.directives.get(id)) ?? null;
    },
    async createRun(input) {
      const directive = mine(db.directives.get(input.directiveId));
      if (!directive) throw new DomainError("NOT_FOUND", "directive not found");
      const run = {
        id: newId(),
        organizationId: org,
        directiveId: input.directiveId,
        parentRunId: input.parentRunId ?? null,
        opportunityId: input.opportunityId ?? null,
        runType: input.runType,
        status: "DRAFT" as const,
        statusReason: null,
        degraded: false,
        stats: {},
        budgetLimitUsd: input.budgetLimitUsd,
        costUsd: 0,
        startedAt: null,
        completedAt: null,
        createdBy: actor.userId,
        createdAt: now(),
      };
      db.runs.set(run.id, run);
      return run;
    },
    async getRun(id) {
      return mine(db.runs.get(id)) ?? null;
    },
    async listRuns(options = {}) {
      return [...db.runs.values()]
        .filter((r) => r.organizationId === org && (!options.opportunityId || r.opportunityId === options.opportunityId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, options.limit ?? 50);
    },
    async transitionRun(id, to, patch = {}) {
      const run = mine(db.runs.get(id));
      if (!run) throw new DomainError("NOT_FOUND", "run not found");
      assertRunTransition(run.status, to);
      const updated = {
        ...run,
        status: to,
        statusReason: patch.statusReason === undefined ? run.statusReason : patch.statusReason,
        degraded: patch.degraded ?? run.degraded,
        stats: patch.stats ? { ...patch.stats } : run.stats,
        costUsd: patch.costUsd ?? run.costUsd,
        startedAt: to === "COLLECTING" && !run.startedAt ? now() : run.startedAt,
        completedAt: ["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"].includes(to) ? now() : run.completedAt,
      };
      db.runs.set(id, updated);
      return updated;
    },
  };

  const evidence: EvidenceRepository = {
    async insertSourceItems(items) {
      const out = [];
      for (const item of items) {
        if (!mine(db.runs.get(item.researchRunId))) throw new DomainError("FORBIDDEN", "run not in organization");
        const clash = [...db.sourceItems.values()].some(
          (s) =>
            s.researchRunId === item.researchRunId &&
            (s.contentHash === item.contentHash ||
              (item.externalId && s.externalId === item.externalId && s.connectorId === item.connectorId)),
        );
        if (clash) continue;
        const row = { ...item, id: newId(), organizationId: org };
        db.sourceItems.set(row.id, row);
        out.push(strip(row));
      }
      return out;
    },
    async listSourceItems(runId) {
      return [...db.sourceItems.values()].filter((s) => s.organizationId === org && s.researchRunId === runId).map(strip);
    },
    async insertEvidence(items) {
      return items.map((e) => {
        const source = mine(db.sourceItems.get(e.sourceItemId));
        if (!source) throw new DomainError("EVIDENCE_INTEGRITY", "evidence references unknown source item");
        assertVerbatim(e.evidenceText, source.body);
        const row = { ...e, sourceUrl: e.sourceUrl ?? source.sourceUrl, id: newId(), organizationId: org };
        db.evidence.set(row.id, row);
        return strip(row);
      });
    },
    async listEvidence(filter) {
      const ids = filter.ids ? new Set(filter.ids) : null;
      return [...db.evidence.values()]
        .filter((e) => e.organizationId === org && (!filter.runId || e.researchRunId === filter.runId) && (!ids || ids.has(e.id)))
        .map(strip);
    },
  };

  const signals: SignalRepository = {
    async insertSignals(rows: NewSignal[]) {
      return rows.map((s) => {
        for (const id of s.evidenceIds) {
          if (!mine(db.evidence.get(id))) throw new DomainError("EVIDENCE_INTEGRITY", `unknown evidence id ${id}`);
        }
        const row = { ...s, id: newId(), organizationId: org, createdAt: now() };
        db.signals.set(row.id, row);
        return strip(row);
      });
    },
    async setEmbeddings(rows) {
      for (const r of rows) {
        const s = mine(db.signals.get(r.id));
        if (s) db.signals.set(r.id, { ...s, embedding: r.embedding, embeddingModel: r.model });
      }
    },
    async listSignals(filter) {
      const ids = filter.ids ? new Set(filter.ids) : null;
      return [...db.signals.values()]
        .filter((s) => s.organizationId === org && (!filter.runId || s.researchRunId === filter.runId) && (!ids || ids.has(s.id)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, filter.limit ?? 1000)
        .map(strip);
    },
    async insertClusters(rows: NewCluster[]) {
      return rows.map((c) => {
        const { centroid: _c, similarities: _s, ...rest } = c;
        void _c;
        void _s;
        const row: StoredCluster & { organizationId: string } = { ...rest, id: newId(), organizationId: org, createdAt: now() };
        db.clusters.set(row.id, row);
        return strip(row);
      });
    },
    async listClusters(filter) {
      return [...db.clusters.values()]
        .filter((c) => c.organizationId === org && (!filter.runId || c.researchRunId === filter.runId))
        .sort((a, b) => b.signalCount - a.signalCount)
        .slice(0, filter.limit ?? 200)
        .map(strip);
    },
    async getCluster(id) {
      const c = mine(db.clusters.get(id));
      return c ? strip(c) : null;
    },
  };

  const opportunities: OpportunityRepository = {
    async createOpportunity({ researchRunId, clusterId, draft, confidence, scoreTotal, momentum }) {
      if (!mine(db.clusters.get(clusterId))) throw new DomainError("EVIDENCE_INTEGRITY", "unknown cluster");
      for (const id of draft.evidenceIds) {
        if (!mine(db.evidence.get(id))) throw new DomainError("EVIDENCE_INTEGRITY", `unknown evidence id ${id}`);
      }
      const { evidenceIds, ...fields } = draft;
      const row = {
        ...fields,
        id: newId(),
        organizationId: org,
        researchRunId,
        clusterId,
        status: "DISCOVERED" as const,
        confidence,
        scoreTotal,
        momentum,
        createdAt: now(),
        updatedAt: now(),
      };
      db.opportunities.set(row.id, row);
      db.opportunityEvidence.set(row.id, [...new Set(evidenceIds)]);
      return row;
    },
    async getOpportunity(id) {
      return mine(db.opportunities.get(id)) ?? null;
    },
    async listOpportunities(filter = {}) {
      return [...db.opportunities.values()]
        .filter(
          (o) =>
            o.organizationId === org &&
            (!filter.runId || o.researchRunId === filter.runId) &&
            (!filter.status || o.status === filter.status),
        )
        .sort((a, b) => (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0))
        .slice(0, filter.limit ?? 100);
    },
    async listOpportunityEvidenceIds(id) {
      return mine(db.opportunities.get(id)) ? (db.opportunityEvidence.get(id) ?? []) : [];
    },
    async saveScore(input) {
      const row = { ...input, id: newId(), organizationId: org, createdAt: now() };
      db.scores.set(row.id, row);
      return strip(row);
    },
    async latestScore(opportunityId) {
      const rows = [...db.scores.values()]
        .filter((s) => s.organizationId === org && s.opportunityId === opportunityId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return rows[0] ? strip(rows[0]) : null;
    },
    async saveRedTeam(input) {
      if (!mine(db.opportunities.get(input.opportunityId))) throw new DomainError("NOT_FOUND", "opportunity not found");
      const row = { ...input, id: newId(), organizationId: org, createdAt: now() };
      db.redTeam.set(row.id, row);
      return strip(row);
    },
    async listRedTeam(opportunityId) {
      return [...db.redTeam.values()]
        .filter((r) => r.organizationId === org && r.opportunityId === opportunityId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(strip);
    },
    async recordDecision(input) {
      if (!mine(db.opportunities.get(input.opportunityId))) throw new DomainError("NOT_FOUND", "opportunity not found");
      const row = { ...input, id: newId(), organizationId: org, decidedBy: actor.userId, createdAt: now() };
      db.decisions.set(row.id, row);
      return strip(row);
    },
    async listDecisions(opportunityId) {
      return [...db.decisions.values()]
        .filter((d) => d.organizationId === org && d.opportunityId === opportunityId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(strip);
    },
    async setStatus(id, to) {
      const opp = mine(db.opportunities.get(id));
      if (!opp) throw new DomainError("NOT_FOUND", "opportunity not found");
      const decided = [...db.decisions.values()].some(
        (d) => d.organizationId === org && d.opportunityId === id && d.fromStatus === opp.status && d.toStatus === to,
      );
      assertOpportunityTransition(opp.status, to, {
        evidenceCount: db.opportunityEvidence.get(id)?.length ?? 0,
        humanDecisionRecorded: decided || !HUMAN_GATED_STATUSES.has(to),
      });
      const updated = { ...opp, status: to, updatedAt: now() };
      db.opportunities.set(id, updated);
      return updated;
    },
  };

  const ops: OpsRepository = {
    async startAgentRun(input) {
      const row: AgentRunRecord & { organizationId: string } = {
        id: newId(),
        organizationId: org,
        agentName: input.agentName,
        provider: input.provider,
        model: input.model,
        researchRunId: input.researchRunId,
        opportunityId: input.opportunityId,
        status: "RUNNING",
        estimatedCost: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        startedAt: now(),
      };
      db.agentRuns.set(row.id, row);
      return strip(row);
    },
    async finishAgentRun(id, patch) {
      const row = mine(db.agentRuns.get(id));
      if (!row || row.status !== "RUNNING") return;
      db.agentRuns.set(id, {
        ...row,
        status: patch.status,
        error: patch.error,
        tokenUsage: patch.tokenUsage ?? row.tokenUsage,
        estimatedCost: patch.estimatedCost ?? 0,
        durationMs: patch.durationMs,
        completedAt: now(),
      });
    },
    async listAgentRuns(filter) {
      return [...db.agentRuns.values()]
        .filter(
          (r) =>
            r.organizationId === org &&
            (!filter.runId || r.researchRunId === filter.runId) &&
            (!filter.opportunityId || r.opportunityId === filter.opportunityId),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, filter.limit ?? 200)
        .map(strip);
    },
    async recordConnectorRun(record) {
      db.connectorRuns.push({ ...record, organizationId: org });
    },
    async listRecentConnectorRuns(limit = 50) {
      return db.connectorRuns
        .filter((r) => r.organizationId === org)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit)
        .map(strip);
    },
    async listConnectorRuns(runId) {
      return db.connectorRuns.filter((r) => r.organizationId === org && r.researchRunId === runId).map(strip);
    },
    async recordCost(entry) {
      db.costs.push({ ...entry, organizationId: org, occurredAt: now() });
    },
    async spendSince(since) {
      const t = since.toISOString();
      return db.costs.filter((c) => c.organizationId === org && c.occurredAt >= t).reduce((n, c) => n + c.amountUsd, 0);
    },
    async spendByRun(runId) {
      return db.costs.filter((c) => c.organizationId === org && c.researchRunId === runId).reduce((n, c) => n + c.amountUsd, 0);
    },
    async getBudget() {
      return db.budgets.get(org) ?? DEFAULT_BUDGET;
    },
    async getScoringWeights() {
      return { id: null, weights: db.scoring.get(org) ?? DEFAULT_SCORING_WEIGHTS };
    },
    async getConnectorSettings() {
      return db.connectorSettings.get(org) ?? [];
    },
    async upsertConnectorSetting(input) {
      const rest = (db.connectorSettings.get(org) ?? []).filter((s) => s.connectorKey !== input.connectorKey);
      rest.push({ connectorKey: input.connectorKey, enabled: input.enabled, complianceStatus: input.complianceStatus, termsNotes: input.termsNotes });
      db.connectorSettings.set(org, rest);
    },
    async audit(action, entityType, entityId, metadata) {
      db.audit.push({ organizationId: org, actorId: actor.userId, action, entityType, entityId, metadata, createdAt: now() });
    },
  };

  return { research, evidence, signals, opportunities, ops };
}
