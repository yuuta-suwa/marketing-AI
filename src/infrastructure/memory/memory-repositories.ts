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
import type { ResearchRun } from "@/domain/research/run";
import { assertVerbatim } from "@/domain/evidence/evidence";
import { assertOpportunityTransition, CEO_GATED_STATUSES, HUMAN_GATED_STATUSES } from "@/domain/opportunity/status";
import { roleAtLeast } from "@/domain/auth/authorization";
import { RUN_ACTION_JA, RUN_PROGRESS } from "@/domain/research/progress";
import { assertRunTransition, isTerminalRunStatus } from "@/domain/research/run-state-machine";
import { DEFAULT_SCORING_WEIGHTS, ScoringWeightsSchema } from "@/domain/scoring/criteria";
import { createMemoryAnalysisRepository } from "./memory-analysis";
import { createMemoryExecutiveRepository } from "./memory-executive";
import { createMemoryJobQueue } from "./memory-jobs";
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

export function createMemoryRepositories(db: MemoryDatabase, actor: Actor, clock: Clock, options: { system?: boolean } = {}): Repositories {
  const org = actor.organizationId;
  const now = () => clock.now().toISOString();
  const mine = <T extends { organizationId: string }>(row: T | undefined): T | undefined =>
    row && row.organizationId === org ? row : undefined;

  /**
   * Mirrors the Phase 6 grants: worker-controlled data (run state, pipeline
   * output, system scores) is written only through trusted (system) repositories.
   */
  const workerOnly = (what: string) => {
    if (!options.system) throw new DomainError("FORBIDDEN", `${what} is worker-only (members cannot modify worker-controlled data)`);
  };

  /** Only partial output of an unfinished run with no opportunities may be discarded. */
  const assertDiscardable = (runId: string) => {
    const run = mine(db.runs.get(runId));
    if (!run) throw new DomainError("NOT_FOUND", "run not found");
    if (isTerminalRunStatus(run.status)) throw new DomainError("CONFLICT", "cannot discard data of a finished run");
    if ([...db.opportunities.values()].some((o) => o.organizationId === org && o.researchRunId === runId)) {
      throw new DomainError("CONFLICT", "opportunities already reference this run");
    }
  };

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
        status: (input.initialStatus ?? "DRAFT") as ResearchRun["status"],
        statusReason: null,
        degraded: false,
        stats: {},
        budgetLimitUsd: input.budgetLimitUsd,
        costUsd: 0,
        progressPercent: 0,
        currentAction: null,
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
        .slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50));
    },
    async requestCancellation(runId) {
      const run = mine(db.runs.get(runId));
      if (!run || !roleAtLeast(actor.role, "member")) throw new DomainError("FORBIDDEN", "research run not found");
      if (isTerminalRunStatus(run.status)) return run.status;
      let processing = 0;
      for (const j of db.jobs.values()) {
        if (j.organizationId !== org || j.researchRunId !== runId) continue;
        if (j.status === "QUEUED" || j.status === "RETRYING") db.jobs.set(j.id, { ...j, status: "CANCELLED", completedAt: now() });
        if (j.status === "PROCESSING") {
          db.jobs.set(j.id, { ...j, cancelRequested: true });
          processing++;
        }
      }
      db.audit.push({ organizationId: org, actorId: actor.userId, action: "research.cancel_requested", entityType: "research_run", entityId: runId, metadata: { processing_jobs: processing }, createdAt: now() });
      if (processing > 0) return "CANCELLING";
      db.runs.set(runId, { ...run, status: "CANCELLED", statusReason: "ユーザーがキャンセルしました", progressPercent: 100, currentAction: "調査はキャンセルされました", completedAt: now() });
      return "CANCELLED";
    },
    async transitionRun(id, to, patch = {}) {
      workerOnly("transitionRun");
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
        progressPercent: patch.progressPercent ?? (to !== run.status ? RUN_PROGRESS[to] : run.progressPercent),
        currentAction: patch.currentAction !== undefined ? patch.currentAction : to !== run.status ? RUN_ACTION_JA[to] : run.currentAction,
        startedAt: to === "COLLECTING" && !run.startedAt ? now() : run.startedAt,
        completedAt: ["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"].includes(to) ? now() : run.completedAt,
      };
      db.runs.set(id, updated);
      return updated;
    },
  };

  const evidence: EvidenceRepository = {
    async insertSourceItems(items) {
      workerOnly("insertSourceItems");
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
      workerOnly("insertEvidence");
      // Validate everything first: the batch is atomic like a single SQL INSERT.
      for (const e of items) {
        const source = mine(db.sourceItems.get(e.sourceItemId));
        if (!source) throw new DomainError("EVIDENCE_INTEGRITY", "evidence references unknown source item");
        assertVerbatim(e.evidenceText, source.body);
      }
      const seen = new Set([...db.evidence.values()].map((x) => `${x.sourceItemId}\u0000${x.evidenceText}`));
      const out = [];
      for (const e of items) {
        const key = `${e.sourceItemId}\u0000${e.evidenceText}`;
        if (seen.has(key)) continue; // unique (source_item_id, md5(evidence_text))
        seen.add(key);
        const source = db.sourceItems.get(e.sourceItemId)!;
        const row = { ...e, sourceUrl: e.sourceUrl ?? source.sourceUrl, id: newId(), organizationId: org };
        db.evidence.set(row.id, row);
        out.push(strip(row));
      }
      return out;
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
      workerOnly("insertSignals");
      return rows.map((s) => {
        if (s.evidenceIds.length === 0) throw new DomainError("EVIDENCE_INTEGRITY", "a signal requires evidence");
        for (const id of s.evidenceIds) {
          if (!mine(db.evidence.get(id))) throw new DomainError("EVIDENCE_INTEGRITY", `unknown evidence id ${id}`);
        }
        const row = { ...s, id: newId(), organizationId: org, createdAt: now() };
        db.signals.set(row.id, row);
        return strip(row);
      });
    },
    async discardRunSignals(runId) {
      workerOnly("discardRunSignals");
      assertDiscardable(runId);
      const ids = [...db.signals.values()].filter((x) => x.organizationId === org && x.researchRunId === runId).map((x) => x.id);
      for (const id of ids) db.signals.delete(id);
      return ids.length;
    },
    async discardRunClusters(runId) {
      workerOnly("discardRunClusters");
      assertDiscardable(runId);
      const ids = [...db.clusters.values()].filter((x) => x.organizationId === org && x.researchRunId === runId).map((x) => x.id);
      for (const id of ids) db.clusters.delete(id);
      return ids.length;
    },
    async setEmbeddings(rows) {
      workerOnly("setEmbeddings");
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
        .slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 1000))
        .map(strip);
    },
    async insertClusters(rows: NewCluster[]) {
      workerOnly("insertClusters");
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
    async countSignalsSince(filter) {
      const q = filter.query?.toLowerCase();
      const rows = [...db.signals.values()].filter(
        (s) =>
          s.organizationId === org &&
          s.createdAt >= filter.since &&
          (!q || s.problem.toLowerCase().includes(q) || (s.category ?? "").toLowerCase().includes(q)) &&
          (!filter.country || s.country === filter.country),
      );
      const byType: Record<string, number> = {};
      for (const s of rows) byType[s.signalType] = (byType[s.signalType] ?? 0) + 1;
      return { total: rows.length, byType };
    },
    async getCluster(id) {
      const c = mine(db.clusters.get(id));
      return c ? strip(c) : null;
    },
  };

  const opportunities: OpportunityRepository = {
    async createOpportunity({ researchRunId, clusterId, draft, confidence, scoreTotal, momentum }) {
      workerOnly("createOpportunity");
      if (!mine(db.clusters.get(clusterId))) throw new DomainError("EVIDENCE_INTEGRITY", "unknown cluster");
      if (draft.evidenceIds.length === 0) throw new DomainError("EVIDENCE_INTEGRITY", "an opportunity requires evidence");
      if ([...db.opportunities.values()].some((o) => o.clusterId === clusterId)) {
        throw new DomainError("CONFLICT", "an opportunity already exists for this cluster");
      }
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
        .slice(filter.offset ?? 0, (filter.offset ?? 0) + (filter.limit ?? 100));
    },
    async listOpportunityEvidenceIds(id) {
      return mine(db.opportunities.get(id)) ? (db.opportunityEvidence.get(id) ?? []) : [];
    },
    async saveScore(input) {
      workerOnly("saveScore");
      const row = { ...input, id: newId(), organizationId: org, createdAt: now() };
      db.scores.set(row.id, row);
      return strip(row);
    },
    async latestScore(opportunityId) {
      // Newest first; insertion order breaks timestamp ties.
      const rows = [...db.scores.values()]
        .filter((s) => s.organizationId === org && s.opportunityId === opportunityId)
        .reverse()
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
        .reverse()
        .filter((r) => r.organizationId === org && r.opportunityId === opportunityId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(strip);
    },
    async recordDecision(input) {
      if (!mine(db.opportunities.get(input.opportunityId))) throw new DomainError("NOT_FOUND", "opportunity not found");
      const row = { source: "UI" as const, ...input, id: newId(), organizationId: org, decidedBy: actor.userId, decidedByRole: actor.role, createdAt: now() };
      db.decisions.set(row.id, row);
      return strip(row);
    },
    async listDecisions(opportunityId) {
      return [...db.decisions.values()]
        .reverse()
        .filter((d) => d.organizationId === org && d.opportunityId === opportunityId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((d) => {
          const { decidedByRole: _r, ...rest } = strip(d as typeof d & { decidedByRole?: string });
          void _r;
          return rest;
        });
    },
    async linkEvidence(opportunityId, evidenceIds, sourceRunId) {
      workerOnly("linkEvidence");
      if (!mine(db.opportunities.get(opportunityId))) throw new DomainError("NOT_FOUND", "opportunity not found");
      const current = new Set(db.opportunityEvidence.get(opportunityId) ?? []);
      let added = 0;
      for (const id of evidenceIds) {
        if (!mine(db.evidence.get(id))) throw new DomainError("EVIDENCE_INTEGRITY", `unknown evidence id ${id}`);
        if (!current.has(id)) {
          current.add(id);
          added++;
          if (sourceRunId) db.opportunityEvidenceSource.set(`${opportunityId}:${id}`, sourceRunId);
        }
      }
      db.opportunityEvidence.set(opportunityId, [...current]);
      return added;
    },
    async updateAssessment(id, patch) {
      // Members may write analysis summaries; system scores are worker-only (column grants).
      if (patch.scoreTotal !== undefined || patch.confidence !== undefined) workerOnly("updateAssessment(score/confidence)");
      const opp = mine(db.opportunities.get(id));
      if (!opp) throw new DomainError("NOT_FOUND", "opportunity not found");
      const updated = { ...opp, ...patch, fieldProvenance: { ...opp.fieldProvenance, ...(patch.fieldProvenance ?? {}) }, updatedAt: now() };
      db.opportunities.set(id, updated);
      return updated;
    },
    async setStatus(id, to) {
      const opp = mine(db.opportunities.get(id));
      if (!opp) throw new DomainError("NOT_FOUND", "opportunity not found");
      // Mirrors the DB gate: PoC approval / launch need an admin/owner (CEO) decision.
      const decided = [...db.decisions.values()].some(
        (d) =>
          d.organizationId === org &&
          d.opportunityId === id &&
          d.fromStatus === opp.status &&
          d.toStatus === to &&
          (!CEO_GATED_STATUSES.has(to) || (d as { decidedByRole?: string }).decidedByRole === "admin" || (d as { decidedByRole?: string }).decidedByRole === "owner"),
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
      workerOnly("recordConnectorRun");
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
    async listCostEntries(runId) {
      return db.costs.filter((c) => c.organizationId === org && c.researchRunId === runId).map(strip);
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
    async updateScoringWeights(weights) {
      ScoringWeightsSchema.parse(weights);
      db.scoring.set(org, { ...weights });
      return { id: null, weights };
    },
    async getConnectorSettings() {
      return db.connectorSettings.get(org) ?? [];
    },
    async upsertConnectorSetting(input) {
      const rest = (db.connectorSettings.get(org) ?? []).filter((s) => s.connectorKey !== input.connectorKey);
      rest.push({ connectorKey: input.connectorKey, enabled: input.enabled, complianceStatus: input.complianceStatus, termsNotes: input.termsNotes });
      db.connectorSettings.set(org, rest);
    },
    async getWorkerHealth() {
      if (!db.platformOperators.has(actor.userId)) throw new DomainError("FORBIDDEN", "platform operator required");
      const t = clock.now().getTime();
      const ready = [...db.jobs.values()].filter((j) => j.organizationId === org && (j.status === "QUEUED" || j.status === "RETRYING") && Date.parse(j.availableAt) <= t);
      const oldest = ready.length ? Math.min(...ready.map((j) => Date.parse(j.availableAt))) : null;
      const workers = [...db.workers.values()].map((w) => {
        const { currentJobId: _hidden, ...rest } = w; // never expose job ids (cross-tenant)
        void _hidden;
        return rest;
      });
      return { workers, oldestQueuedSeconds: oldest === null ? null : Math.round((t - oldest) / 1000), now: clock.now().toISOString() };
    },
    async consumeRateLimit(bucket, maxEvents, windowSeconds) {
      const key = `${actor.userId}:${bucket}`;
      const t = clock.now().getTime();
      const recent = (db.rateLimits.get(key) ?? []).filter((x) => x > t - windowSeconds * 1000);
      if (recent.length >= maxEvents) {
        db.rateLimits.set(key, recent);
        return false;
      }
      db.rateLimits.set(key, [...recent, t]);
      return true;
    },
    async audit(action, entityType, entityId, metadata) {
      db.audit.push({ organizationId: org, actorId: actor.userId, action, entityType, entityId, metadata, createdAt: now() });
    },
  };

  return {
    jobs: createMemoryJobQueue(db, actor, clock),
    research,
    evidence,
    signals,
    opportunities,
    ops,
    analysis: createMemoryAnalysisRepository(db, actor, clock),
    executive: createMemoryExecutiveRepository(db, actor, clock, options),
  };
}
