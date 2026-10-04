import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutiveRepository, LineageRow, StoredAdvisorSession, StoredFeedback, StoredNotification, StoredReport, StoredWatchlist, StoredQualityReview } from "@/application/ports/repositories";
import type { Actor } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come from PostgREST untyped */
type Row = Record<string, any>;
type PgResult = { data: any; error: { message: string; code?: string } | null };

function must(res: PgResult, what: string): any {
  if (res.error) {
    if (res.error.code === "42501") throw new DomainError("FORBIDDEN", `${what}: ${res.error.message}`);
    if (res.error.code === "23503") throw new DomainError("NOT_FOUND", `${what}: ${res.error.message}`);
    if (res.error.code === "23514") throw new DomainError("VALIDATION", `${what}: ${res.error.message}`);
    throw new Error(`${what}: ${res.error.message}`);
  }
  if (res.data === null || res.data === undefined) throw new DomainError("NOT_FOUND", `${what}: not found`);
  return res.data;
}
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

export const mapAdvisor = (r: Row): StoredAdvisorSession => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  status: r.status,
  perspectives: r.perspectives,
  consensus: r.consensus ?? "",
  disagreements: r.disagreements,
  unansweredQuestions: r.unanswered_questions,
  criticalAssumptions: r.critical_assumptions,
  requiredEvidence: r.required_evidence,
  createdAt: r.created_at,
});
export const mapReport = (r: Row): StoredReport => ({
  id: r.id,
  reportType: r.report_type,
  title: r.title,
  contentMd: r.content_md,
  contentJson: r.content_json ?? {},
  opportunityId: opt(r.opportunity_id),
  periodStart: opt(r.period_start),
  periodEnd: opt(r.period_end),
  createdAt: r.created_at,
});
export const mapWatchlist = (r: Row): StoredWatchlist => ({
  id: r.id,
  organizationId: r.organization_id,
  userId: r.user_id,
  targetType: r.target_type,
  targetId: opt(r.target_id),
  query: opt(r.query),
  label: opt(r.label),
  scheduleCron: opt(r.schedule_cron),
  active: r.active,
  lastCheckedAt: opt(r.last_checked_at),
  snapshot: r.settings?.snapshot,
  createdAt: r.created_at,
});
export const mapNotification = (r: Row): StoredNotification => ({
  id: r.id,
  userId: r.user_id,
  kind: r.kind,
  title: r.title,
  body: opt(r.body),
  link: opt(r.link),
  severity: r.severity,
  watchlistId: opt(r.watchlist_id),
  readAt: opt(r.read_at),
  createdAt: r.created_at,
});
const mapFeedback = (r: Row): StoredFeedback => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  experimentId: opt(r.experiment_id),
  metric: r.metric,
  value: r.value === null ? undefined : Number(r.value),
  unit: opt(r.unit),
  note: opt(r.note),
  occurredAt: r.occurred_at,
  recordedBy: r.recorded_by,
});

export function createSupabaseExecutiveRepository(db: SupabaseClient, actor: Actor): ExecutiveRepository {
  const org = actor.organizationId;
  const mapReview = (r: Row): StoredQualityReview => ({
    id: r.id,
    researchRunId: r.research_run_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    useful: r.useful ?? null,
    rating: r.rating ?? null,
    decision: r.decision,
    note: r.note ?? undefined,
    reviewedBy: r.reviewed_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  return {
    async upsertQualityReview(input) {
      const row: Record<string, unknown> = {
        organization_id: org,
        research_run_id: input.researchRunId,
        entity_type: input.entityType,
        entity_id: input.entityId,
        reviewed_by: actor.userId,
      };
      if (input.useful !== undefined) row.useful = input.useful;
      if (input.rating !== undefined) row.rating = input.rating;
      if (input.decision !== undefined) row.decision = input.decision;
      if (input.note !== undefined) row.note = input.note;
      return mapReview(
        must(
          await db.from("quality_reviews").upsert(row, { onConflict: "organization_id,entity_type,entity_id,reviewed_by" }).select().single(),
          "upsert quality review",
        ) as Row,
      );
    },
    async listQualityReviews(researchRunId) {
      return (must(await db.from("quality_reviews").select().eq("organization_id", org).eq("research_run_id", researchRunId).limit(2000), "list quality reviews") as Row[]).map(mapReview);
    },
    async saveAdvisorSession(opportunityId, c) {
      return mapAdvisor(
        must(
          await db
            .from("advisor_sessions")
            .insert({
              organization_id: org,
              opportunity_id: opportunityId,
              perspectives: c.perspectives,
              consensus: c.consensus,
              disagreements: c.disagreements,
              unanswered_questions: c.unansweredQuestions,
              critical_assumptions: c.criticalAssumptions,
              required_evidence: c.requiredEvidence,
              status: "COMPLETED",
              created_by: actor.userId,
            })
            .select()
            .single(),
          "save advisor session",
        ),
      );
    },
    async listAdvisorSessions(opportunityId) {
      return (must(await db.from("advisor_sessions").select().eq("organization_id", org).eq("opportunity_id", opportunityId).order("created_at", { ascending: false }).limit(10), "list advisor sessions") as Row[]).map(mapAdvisor);
    },
    async saveReport(input) {
      return mapReport(
        must(
          await db
            .from("reports")
            .insert({
              organization_id: org,
              report_type: input.reportType,
              title: input.title,
              content_md: input.contentMd,
              content_json: input.contentJson,
              opportunity_id: input.opportunityId ?? null,
              period_start: input.periodStart ?? null,
              period_end: input.periodEnd ?? null,
              created_by: actor.userId,
            })
            .select()
            .single(),
          "save report",
        ),
      );
    },
    async getReport(id) {
      const res = await db.from("reports").select().eq("organization_id", org).eq("id", id).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return res.data ? mapReport(res.data) : null;
    },
    async listReports(filter) {
      let q = db.from("reports").select().eq("organization_id", org).order("created_at", { ascending: false }).limit(filter.limit ?? 50);
      if (filter.type) q = q.eq("report_type", filter.type);
      if (filter.opportunityId) q = q.eq("opportunity_id", filter.opportunityId);
      return (must(await q, "list reports") as Row[]).map(mapReport);
    },
    async createWatchlist(input) {
      const res = await db
        .from("watchlists")
        .insert({
          organization_id: org,
          user_id: actor.userId,
          target_type: input.targetType,
          target_id: input.targetId ?? null,
          query: input.query ?? null,
          label: input.label ?? null,
          schedule_cron: input.scheduleCron ?? null,
        })
        .select()
        .single();
      if (res.error?.code === "23505") {
        const existing = (await this.listWatchlists({ activeOnly: true, mineOnly: true })).find(
          (w) => w.targetType === input.targetType && (w.targetId ?? w.query?.toLowerCase()) === (input.targetId ?? input.query?.toLowerCase()),
        );
        if (existing) return existing;
      }
      return mapWatchlist(must(res, "create watchlist"));
    },
    async listWatchlists(filter = {}) {
      let q = db.from("watchlists").select().eq("organization_id", org).order("created_at", { ascending: false }).limit(200);
      if (filter.activeOnly) q = q.eq("active", true);
      if (filter.mineOnly) q = q.eq("user_id", actor.userId);
      return (must(await q, "list watchlists") as Row[]).map(mapWatchlist);
    },
    async updateWatchlist(id, patch) {
      const update: Row = {};
      if (patch.active !== undefined) update.active = patch.active;
      if (patch.lastCheckedAt) update.last_checked_at = patch.lastCheckedAt;
      if (patch.snapshot) update.settings = { snapshot: patch.snapshot };
      must(await db.from("watchlists").update(update).eq("organization_id", org).eq("id", id).select("id").single(), "update watchlist");
    },
    async createNotification(input) {
      const res = await db.from("notifications").insert({
        organization_id: org,
        user_id: input.userId,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        severity: input.severity,
        watchlist_id: input.watchlistId ?? null,
        dedupe_key: input.dedupeKey ?? null,
      });
      if (res.error?.code === "23505") return false;
      if (res.error) throw new Error(`create notification: ${res.error.message}`);
      return true;
    },
    async listNotifications(filter = {}) {
      let q = db.from("notifications").select().eq("organization_id", org).eq("user_id", actor.userId).order("created_at", { ascending: false }).limit(filter.limit ?? 50);
      if (filter.unreadOnly) q = q.is("read_at", null);
      return (must(await q, "list notifications") as Row[]).map(mapNotification);
    },
    async markNotificationRead(id) {
      must(await db.from("notifications").update({ read_at: new Date().toISOString() }).eq("organization_id", org).eq("id", id).select("id").single(), "mark read");
    },
    async recordFeedback(input) {
      return mapFeedback(
        must(
          await db
            .from("feedback_events")
            .insert({
              organization_id: org,
              opportunity_id: input.opportunityId,
              experiment_id: input.experimentId ?? null,
              metric: input.metric,
              value: input.value ?? null,
              unit: input.unit ?? null,
              note: input.note ?? null,
              occurred_at: input.occurredAt,
              recorded_by: actor.userId,
            })
            .select()
            .single(),
          "record feedback",
        ),
      );
    },
    async listFeedback(opportunityId) {
      return (must(await db.from("feedback_events").select().eq("organization_id", org).eq("opportunity_id", opportunityId).order("occurred_at", { ascending: false }), "list feedback") as Row[]).map(mapFeedback);
    },
    async listLineage() {
      const rows = must(await db.from("opportunity_lineage").select().eq("organization_id", org).order("revenue_total", { ascending: false }).limit(500), "lineage") as Row[];
      return rows.map(
        (r): LineageRow => ({
          opportunityId: r.opportunity_id,
          title: r.title,
          status: r.status,
          scoreTotal: r.score_total === null ? null : Number(r.score_total),
          confidence: r.confidence,
          signalCount: Number(r.signal_count),
          evidenceCount: Number(r.evidence_count),
          experimentCount: Number(r.experiment_count),
          experimentsPositive: Number(r.experiments_positive),
          revenueTotal: Number(r.revenue_total),
          feedbackCount: Number(r.feedback_count),
        }),
      );
    },
  };
}
