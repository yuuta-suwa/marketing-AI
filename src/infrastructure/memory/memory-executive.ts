import type { ExecutiveRepository, LineageRow } from "@/application/ports/repositories";
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

export function createMemoryExecutiveRepository(db: MemoryDatabase, actor: Actor, clock: Clock, options: { system?: boolean } = {}): ExecutiveRepository {
  const org = actor.organizationId;
  const now = () => clock.now().toISOString();
  const ownOpp = (id: string) => {
    const o = db.opportunities.get(id);
    if (!o || o.organizationId !== org) throw new DomainError("NOT_FOUND", "opportunity not found");
    return o;
  };
  const newestFirst = <T extends { createdAt: string }>(rows: T[]) => rows.reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    async saveAdvisorSession(opportunityId, result) {
      ownOpp(opportunityId);
      const row = { ...result, id: newId(), organizationId: org, opportunityId, status: "COMPLETED" as const, createdAt: now() };
      db.advisorSessions.set(row.id, row);
      return strip(row);
    },
    async listAdvisorSessions(opportunityId) {
      return newestFirst([...db.advisorSessions.values()].filter((s) => s.organizationId === org && s.opportunityId === opportunityId)).map(strip);
    },
    async saveReport(input) {
      if (input.opportunityId) ownOpp(input.opportunityId);
      const row = { ...input, id: newId(), organizationId: org, createdAt: now() };
      db.reports.set(row.id, row);
      return strip(row);
    },
    async getReport(id) {
      const r = db.reports.get(id);
      return r && r.organizationId === org ? strip(r) : null;
    },
    async listReports(filter) {
      return newestFirst(
        [...db.reports.values()].filter(
          (r) => r.organizationId === org && (!filter.type || r.reportType === filter.type) && (!filter.opportunityId || r.opportunityId === filter.opportunityId),
        ),
      )
        .slice(0, filter.limit ?? 50)
        .map(strip);
    },
    async createWatchlist(input) {
      if (input.targetType === "OPPORTUNITY") {
        if (!input.targetId) throw new DomainError("VALIDATION", "opportunity id required");
        ownOpp(input.targetId);
      } else if (input.targetId) {
        throw new DomainError("VALIDATION", "only OPPORTUNITY watchlists may reference a target id");
      }
      const key = input.targetId ?? input.query?.toLowerCase();
      const dup = [...db.watchlists.values()].find(
        (w) => w.organizationId === org && w.userId === actor.userId && w.active && w.targetType === input.targetType && (w.targetId ?? w.query?.toLowerCase()) === key,
      );
      if (dup) return dup;
      const row = { ...input, id: newId(), organizationId: org, userId: actor.userId, active: true, createdAt: now() };
      db.watchlists.set(row.id, row);
      return row;
    },
    async listWatchlists(filter = {}) {
      return newestFirst(
        [...db.watchlists.values()].filter(
          (w) => w.organizationId === org && (!filter.activeOnly || w.active) && (!filter.mineOnly || w.userId === actor.userId),
        ),
      );
    },
    async updateWatchlist(id, patch) {
      const w = db.watchlists.get(id);
      if (!w || w.organizationId !== org) throw new DomainError("NOT_FOUND", "watchlist not found");
      if (patch.active !== undefined && w.userId !== actor.userId && actor.role !== "admin" && actor.role !== "owner") {
        throw new DomainError("FORBIDDEN", "not your watchlist");
      }
      db.watchlists.set(id, { ...w, ...patch });
    },
    async createNotification(input) {
      if (!options.system && input.userId !== actor.userId) throw new DomainError("FORBIDDEN", "notifications can only be created for yourself");
      if (input.dedupeKey && [...db.notifications.values()].some((n) => n.userId === input.userId && n.dedupeKey === input.dedupeKey)) return false;
      const row = { ...input, id: newId(), organizationId: org, createdAt: now() };
      db.notifications.set(row.id, row);
      return true;
    },
    async listNotifications(filter = {}) {
      return newestFirst([...db.notifications.values()].filter((n) => n.organizationId === org && n.userId === actor.userId && (!filter.unreadOnly || !n.readAt)))
        .slice(0, filter.limit ?? 50)
        .map((n) => {
          const { dedupeKey: _d, ...rest } = strip(n);
          void _d;
          return rest;
        });
    },
    async markNotificationRead(id) {
      const n = db.notifications.get(id);
      if (!n || n.userId !== actor.userId) throw new DomainError("NOT_FOUND", "notification not found");
      db.notifications.set(id, { ...n, readAt: now() });
    },
    async upsertQualityReview(input) {
      const target =
        input.entityType === "SIGNAL" ? db.signals.get(input.entityId) : db.opportunities.get(input.entityId);
      if (!target || target.organizationId !== org || target.researchRunId !== input.researchRunId) {
        throw new DomainError("NOT_FOUND", "review target not found in this run");
      }
      if (input.rating !== undefined && input.rating !== null && (input.rating < 1 || input.rating > 5)) throw new DomainError("VALIDATION", "rating must be 1-5");
      const key = `${org}:${input.entityType}:${input.entityId}:${actor.userId}`;
      const prev = db.qualityReviews.get(key);
      const row = {
        id: prev?.id ?? newId(),
        organizationId: org,
        researchRunId: input.researchRunId,
        entityType: input.entityType,
        entityId: input.entityId,
        useful: input.useful !== undefined ? input.useful : (prev?.useful ?? null),
        rating: input.rating !== undefined ? input.rating : (prev?.rating ?? null),
        decision: input.decision ?? prev?.decision ?? ("NONE" as const),
        note: input.note ?? prev?.note,
        reviewedBy: actor.userId,
        createdAt: prev?.createdAt ?? now(),
        updatedAt: now(),
      };
      db.qualityReviews.set(key, row);
      return strip(row);
    },
    async listQualityReviews(researchRunId) {
      return [...db.qualityReviews.values()].filter((r) => r.organizationId === org && r.researchRunId === researchRunId).map(strip);
    },
    async recordFeedback(input) {
      ownOpp(input.opportunityId);
      if (input.experimentId) {
        const e = db.experiments.get(input.experimentId);
        if (!e || e.organizationId !== org || e.opportunityId !== input.opportunityId) throw new DomainError("NOT_FOUND", "experiment not found");
      }
      if (input.value === undefined && !input.note) throw new DomainError("VALIDATION", "value or note required");
      const row = { ...input, id: newId(), organizationId: org, recordedBy: actor.userId };
      db.feedback.set(row.id, row);
      return strip(row);
    },
    async listFeedback(opportunityId) {
      return [...db.feedback.values()].filter((f) => f.organizationId === org && f.opportunityId === opportunityId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map(strip);
    },
    async listLineage() {
      const rows: LineageRow[] = [];
      for (const o of db.opportunities.values()) {
        if (o.organizationId !== org) continue;
        const exps = [...db.experiments.values()].filter((e) => e.opportunityId === o.id);
        const fb = [...db.feedback.values()].filter((f) => f.opportunityId === o.id);
        rows.push({
          opportunityId: o.id,
          title: o.title,
          status: o.status,
          scoreTotal: o.scoreTotal,
          confidence: o.confidence,
          signalCount: db.clusters.get(o.clusterId)?.signalIds.length ?? 0,
          evidenceCount: db.opportunityEvidence.get(o.id)?.length ?? 0,
          experimentCount: exps.length,
          experimentsPositive: exps.filter((e) => e.decision === "CONTINUE" || e.decision === "SCALE").length,
          revenueTotal: fb.filter((f) => f.metric === "REVENUE").reduce((n, f) => n + (f.value ?? 0), 0),
          feedbackCount: fb.length,
        });
      }
      return rows.sort((a, b) => b.revenueTotal - a.revenueTotal || (b.scoreTotal ?? 0) - (a.scoreTotal ?? 0));
    },
  };
}
