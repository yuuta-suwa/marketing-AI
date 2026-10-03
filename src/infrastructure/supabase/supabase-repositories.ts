import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EvidenceRepository,
  OpportunityRepository,
  OpsRepository,
  Repositories,
  ResearchRepository,
  SignalRepository,
} from "@/application/ports/repositories";
import type { Actor } from "@/domain/auth/authorization";
import { DEFAULT_SCORING_WEIGHTS, type ScoringWeights } from "@/domain/scoring/criteria";
import { DomainError } from "@/domain/shared/errors";
import {
  OPPORTUNITY_COLUMNS,
  mapAgentRun,
  mapCluster,
  mapConnectorRun,
  mapDecision,
  mapDirective,
  mapEvidence,
  mapOpportunity,
  mapRedTeam,
  mapRun,
  mapScore,
  mapSignal,
  mapSourceItem,
  toVectorLiteral,
} from "./mappers";

type PgResult<T> = { data: T | null; error: { message: string; code?: string } | null };

/** Unwraps a PostgREST result; database errors are never swallowed. */
function must<T>(res: PgResult<T>, what: string): NonNullable<T> {
  if (res.error) {
    const code = res.error.code;
    if (code === "42501") throw new DomainError("FORBIDDEN", `${what}: ${res.error.message}`);
    if (code === "23514") throw new DomainError("ILLEGAL_TRANSITION", `${what}: ${res.error.message}`);
    if (code === "23503") throw new DomainError("EVIDENCE_INTEGRITY", `${what}: ${res.error.message}`);
    throw new Error(`${what}: ${res.error.message}`);
  }
  if (res.data === null || res.data === undefined) throw new DomainError("NOT_FOUND", `${what}: not found`);
  return res.data as NonNullable<T>;
}

const SIGNAL_SELECT = "*, signal_evidence(evidence_id)";
const CLUSTER_SELECT = "id, organization_id, research_run_id, name, summary, signal_count, source_count, countries, languages, first_seen, last_seen, momentum, pain_score, pay_signal_score, confidence, naming_method, created_at, cluster_signals(signal_id)";

/**
 * Supabase-backed repositories. The client MUST be the user-scoped server
 * client so RLS enforces tenancy; organization_id is still written
 * explicitly and RLS rejects any mismatch.
 */
export function createSupabaseRepositories(db: SupabaseClient, actor: Actor): Repositories {
  const org = actor.organizationId;

  const research: ResearchRepository = {
    async createDirective({ directive, parser, parseMetadata }) {
      const row = must(
        await db
          .from("research_directives")
          .insert({
            organization_id: org,
            raw_input: directive.rawInput,
            objective: directive.objective,
            countries: directive.countries,
            languages: directive.languages,
            personas: directive.personas,
            categories: directive.categories,
            keywords: directive.keywords,
            negative_keywords: directive.negativeKeywords,
            time_range: directive.timeRange,
            source_preferences: directive.sourcePreferences,
            max_items: directive.maxItems,
            budget_limit_usd: directive.budgetLimitUsd,
            deep_research: directive.deepResearch,
            parser,
            parse_metadata: parseMetadata ?? {},
            created_by: actor.userId,
          })
          .select()
          .single(),
        "create directive",
      );
      return mapDirective(row);
    },
    async getDirective(id) {
      const res = await db.from("research_directives").select().eq("id", id).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return res.data ? mapDirective(res.data) : null;
    },
    async createRun(input) {
      const row = must(
        await db
          .from("research_runs")
          .insert({
            organization_id: org,
            directive_id: input.directiveId,
            run_type: input.runType,
            budget_limit_usd: input.budgetLimitUsd,
            parent_run_id: input.parentRunId ?? null,
            opportunity_id: input.opportunityId ?? null,
            created_by: actor.userId,
          })
          .select()
          .single(),
        "create run",
      );
      return mapRun(row);
    },
    async getRun(id) {
      const res = await db.from("research_runs").select().eq("id", id).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return res.data ? mapRun(res.data) : null;
    },
    async listRuns(options = {}) {
      let q = db.from("research_runs").select().eq("organization_id", org).order("created_at", { ascending: false }).limit(options.limit ?? 50);
      if (options.opportunityId) q = q.eq("opportunity_id", options.opportunityId);
      return must(await q, "list runs").map(mapRun);
    },
    async transitionRun(id, to, patch = {}) {
      const update: Record<string, unknown> = { status: to };
      if (patch.statusReason !== undefined) update.status_reason = patch.statusReason;
      if (patch.degraded !== undefined) update.degraded = patch.degraded;
      if (patch.stats !== undefined) update.stats = patch.stats;
      if (patch.costUsd !== undefined) update.cost_usd = patch.costUsd;
      return mapRun(must(await db.from("research_runs").update(update).eq("id", id).select().single(), `run -> ${to}`));
    },
  };

  const evidence: EvidenceRepository = {
    async insertSourceItems(items) {
      if (items.length === 0) return [];
      const rows = must(
        await db
          .from("source_items")
          .upsert(
            items.map((s) => ({
              organization_id: org,
              research_run_id: s.researchRunId,
              connector_key: s.connectorId,
              source_type: s.sourceType,
              source_name: s.sourceName,
              source_url: s.sourceUrl ?? null,
              canonical_url: s.canonicalUrl ?? null,
              external_id: s.externalId ?? null,
              title: s.title ?? null,
              body: s.body,
              language: s.language ?? null,
              country: s.country ?? null,
              published_at: s.publishedAt ?? null,
              retrieved_at: s.retrievedAt,
              engagement: s.engagement ?? {},
              metadata: s.metadata ?? {},
              content_hash: s.contentHash,
              compliance_status: s.complianceStatus,
            })),
            { onConflict: "research_run_id,content_hash", ignoreDuplicates: true },
          )
          .select(),
        "insert source items",
      );
      return rows.map(mapSourceItem);
    },
    async listSourceItems(runId) {
      return must(await db.from("source_items").select().eq("research_run_id", runId), "list source items").map(mapSourceItem);
    },
    async insertEvidence(items) {
      if (items.length === 0) return [];
      const rows = must(
        await db
          .from("evidence")
          .insert(
            items.map((e) => ({
              organization_id: org,
              research_run_id: e.researchRunId,
              source_item_id: e.sourceItemId,
              source_url: e.sourceUrl ?? null,
              evidence_text: e.evidenceText,
              evidence_summary: e.evidenceSummary ?? null,
              evidence_type: e.evidenceType,
              retrieved_at: e.retrievedAt,
              confidence: e.confidence,
              language: e.language ?? null,
              country: e.country ?? null,
            })),
          )
          .select(),
        "insert evidence",
      );
      return rows.map(mapEvidence);
    },
    async listEvidence(filter) {
      let q = db.from("evidence").select();
      if (filter.runId) q = q.eq("research_run_id", filter.runId);
      if (filter.ids) {
        if (filter.ids.length === 0) return [];
        q = q.in("id", filter.ids);
      }
      return must(await q.limit(2000), "list evidence").map(mapEvidence);
    },
  };

  const signals: SignalRepository = {
    async insertSignals(rows) {
      if (rows.length === 0) return [];
      const inserted = must(
        await db
          .from("signals")
          .insert(
            rows.map((s) => ({
              organization_id: org,
              research_run_id: s.researchRunId,
              persona: s.persona ?? null,
              situation: s.situation ?? null,
              problem: s.problem,
              desired_outcome: s.desiredOutcome ?? null,
              current_alternative: s.currentAlternative ?? null,
              alternative_failure: s.alternativeFailure ?? null,
              urgency_score: s.urgencyScore,
              frequency_signal: s.frequencySignal,
              willingness_to_pay_score: s.willingnessToPayScore,
              switching_intent_score: s.switchingIntentScore,
              trust_issue: s.trustIssue,
              price_issue: s.priceIssue,
              access_issue: s.accessIssue,
              category: s.category ?? null,
              location: s.location ?? null,
              signal_type: s.signalType,
              confidence: s.confidence,
              language: s.language ?? null,
              country: s.country ?? null,
              extracted_by: s.extractedBy,
            })),
          )
          .select("id"),
        "insert signals",
      ) as Array<{ id: string }>;
      const links = inserted.flatMap((row, i) =>
        [...new Set(rows[i].evidenceIds)].map((evidenceId) => ({ signal_id: row.id, evidence_id: evidenceId, organization_id: org })),
      );
      if (links.length > 0) must(await db.from("signal_evidence").insert(links).select("signal_id"), "link signal evidence");
      return signals.listSignals({ ids: inserted.map((r) => r.id) });
    },
    async setEmbeddings(rows) {
      for (const r of rows) {
        must(
          await db.from("signals").update({ embedding: toVectorLiteral(r.embedding), embedding_model: r.model }).eq("id", r.id).select("id").single(),
          "set embedding",
        );
      }
    },
    async listSignals(filter) {
      let q = db.from("signals").select(SIGNAL_SELECT).order("created_at", { ascending: false }).limit(filter.limit ?? 1000);
      if (filter.runId) q = q.eq("research_run_id", filter.runId);
      if (filter.ids) {
        if (filter.ids.length === 0) return [];
        q = q.in("id", filter.ids);
      }
      return must(await q, "list signals").map(mapSignal);
    },
    async insertClusters(rows) {
      const out = [];
      for (const c of rows) {
        const row = must(
          await db
            .from("signal_clusters")
            .insert({
              organization_id: org,
              research_run_id: c.researchRunId,
              name: c.name,
              summary: c.summary ?? null,
              signal_count: c.signalCount,
              source_count: c.sourceCount,
              countries: c.countries,
              languages: c.languages,
              first_seen: c.firstSeen ?? null,
              last_seen: c.lastSeen ?? null,
              momentum: c.momentum,
              pain_score: c.painScore,
              pay_signal_score: c.paySignalScore,
              confidence: c.confidence,
              centroid: c.centroid && c.centroid.length > 0 ? toVectorLiteral(c.centroid) : null,
              naming_method: c.namingMethod,
            })
            .select("id")
            .single(),
          "insert cluster",
        ) as { id: string };
        must(
          await db
            .from("cluster_signals")
            .insert(c.signalIds.map((signalId) => ({ cluster_id: row.id, signal_id: signalId, organization_id: org, similarity: c.similarities[signalId] ?? null })))
            .select("signal_id"),
          "link cluster signals",
        );
        const cluster = await signals.getCluster(row.id);
        if (cluster) out.push(cluster);
      }
      return out;
    },
    async listClusters(filter) {
      let q = db.from("signal_clusters").select(CLUSTER_SELECT).order("signal_count", { ascending: false }).limit(filter.limit ?? 200);
      if (filter.runId) q = q.eq("research_run_id", filter.runId);
      return must(await q, "list clusters").map(mapCluster);
    },
    async getCluster(id) {
      const res = await db.from("signal_clusters").select(CLUSTER_SELECT).eq("id", id).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return res.data ? mapCluster(res.data) : null;
    },
  };

  const opportunities: OpportunityRepository = {
    async createOpportunity({ researchRunId, clusterId, draft, confidence, scoreTotal, momentum }) {
      const row: Record<string, unknown> = {
        organization_id: org,
        research_run_id: researchRunId,
        cluster_id: clusterId,
        title: draft.title,
        field_provenance: draft.fieldProvenance,
        confidence,
        score_total: scoreTotal,
        momentum,
        created_by: actor.userId,
      };
      for (const [k, col] of Object.entries(OPPORTUNITY_COLUMNS)) {
        row[col] = (draft as Record<string, unknown>)[k] ?? null;
      }
      const created = must(await db.from("opportunities").insert(row).select().single(), "create opportunity") as Record<string, unknown> & { id: string };
      must(
        await db
          .from("opportunity_evidence")
          .insert([...new Set(draft.evidenceIds)].map((evidenceId) => ({ opportunity_id: created.id, evidence_id: evidenceId, organization_id: org })))
          .select("evidence_id"),
        "link opportunity evidence",
      );
      return mapOpportunity(created);
    },
    async getOpportunity(id) {
      const res = await db.from("opportunities").select().eq("id", id).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return res.data ? mapOpportunity(res.data) : null;
    },
    async listOpportunities(filter = {}) {
      let q = db.from("opportunities").select().eq("organization_id", org).order("score_total", { ascending: false, nullsFirst: false }).limit(filter.limit ?? 100);
      if (filter.runId) q = q.eq("research_run_id", filter.runId);
      if (filter.status) q = q.eq("status", filter.status);
      return must(await q, "list opportunities").map(mapOpportunity);
    },
    async listOpportunityEvidenceIds(id) {
      const rows = must(await db.from("opportunity_evidence").select("evidence_id").eq("opportunity_id", id), "list opportunity evidence");
      return (rows as Array<{ evidence_id: string }>).map((r) => r.evidence_id);
    },
    async saveScore(input) {
      const row = must(
        await db
          .from("opportunity_scores")
          .insert({
            organization_id: org,
            opportunity_id: input.opportunityId,
            weights: input.weights,
            components: { components: input.score.components, coverage: input.score.coverage, missing: input.score.missing },
            total: input.score.total,
            confidence: input.confidence,
            confidence_breakdown: input.confidenceBreakdown,
            scored_by: input.scoredBy,
          })
          .select()
          .single(),
        "save score",
      );
      return mapScore(row);
    },
    async latestScore(opportunityId) {
      const res = await db.from("opportunity_scores").select().eq("opportunity_id", opportunityId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return res.data ? mapScore(res.data) : null;
    },
    async saveRedTeam(input) {
      const row = must(
        await db
          .from("red_team_reviews")
          .insert({
            organization_id: org,
            opportunity_id: input.opportunityId,
            research_run_id: input.researchRunId ?? null,
            findings: input.findings,
            biggest_assumption: input.biggestAssumption,
            worst_case: input.worstCase,
            kill_criteria: input.killCriteria,
            verdict: input.verdict,
            created_by: input.createdBy,
          })
          .select()
          .single(),
        "save red team",
      );
      return mapRedTeam(row);
    },
    async listRedTeam(opportunityId) {
      return must(await db.from("red_team_reviews").select().eq("opportunity_id", opportunityId).order("created_at", { ascending: false }), "list red team").map(mapRedTeam);
    },
    async recordDecision(input) {
      const row = must(
        await db
          .from("decisions")
          .insert({
            organization_id: org,
            opportunity_id: input.opportunityId,
            decision: input.decision,
            from_status: input.fromStatus,
            to_status: input.toStatus,
            rationale: input.rationale ?? null,
            decided_by: actor.userId,
          })
          .select()
          .single(),
        "record decision",
      );
      return mapDecision(row);
    },
    async listDecisions(opportunityId) {
      return must(await db.from("decisions").select().eq("opportunity_id", opportunityId).order("created_at", { ascending: false }), "list decisions").map(mapDecision);
    },
    async setStatus(id, to) {
      return mapOpportunity(must(await db.from("opportunities").update({ status: to }).eq("id", id).select().single(), `opportunity -> ${to}`));
    },
  };

  const ops: OpsRepository = {
    async startAgentRun(input) {
      const row = must(
        await db
          .from("agent_runs")
          .insert({
            organization_id: org,
            agent_name: input.agentName,
            provider: input.provider,
            model: input.model,
            input_json: input.inputJson ?? {},
            research_run_id: input.researchRunId ?? null,
            opportunity_id: input.opportunityId ?? null,
            status: "RUNNING",
          })
          .select()
          .single(),
        "start agent run",
      );
      return mapAgentRun(row);
    },
    async finishAgentRun(id, patch) {
      must(
        await db
          .from("agent_runs")
          .update({
            status: patch.status,
            output_json: patch.outputJson ?? null,
            error: patch.error ?? null,
            token_usage: patch.tokenUsage ?? {},
            estimated_cost: patch.estimatedCost ?? 0,
            duration_ms: patch.durationMs,
            completed_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("id")
          .single(),
        "finish agent run",
      );
    },
    async listAgentRuns(filter) {
      let q = db.from("agent_runs").select().eq("organization_id", org).order("started_at", { ascending: false }).limit(filter.limit ?? 200);
      if (filter.runId) q = q.eq("research_run_id", filter.runId);
      if (filter.opportunityId) q = q.eq("opportunity_id", filter.opportunityId);
      return must(await q, "list agent runs").map(mapAgentRun);
    },
    async recordConnectorRun(r) {
      must(
        await db
          .from("connector_runs")
          .insert({
            organization_id: org,
            research_run_id: r.researchRunId,
            connector_key: r.connectorKey,
            status: r.status,
            result_count: r.resultCount,
            duplicate_count: r.duplicateCount,
            duration_ms: r.durationMs,
            retry_count: r.retryCount,
            error: r.error ?? null,
            started_at: r.startedAt,
            completed_at: r.completedAt,
          })
          .select("id")
          .single(),
        "record connector run",
      );
    },
    async listConnectorRuns(runId) {
      return must(await db.from("connector_runs").select().eq("research_run_id", runId).order("started_at"), "list connector runs").map(mapConnectorRun);
    },
    async recordCost(e) {
      must(
        await db
          .from("cost_ledger")
          .insert({
            organization_id: org,
            research_run_id: e.researchRunId ?? null,
            agent_run_id: e.agentRunId ?? null,
            category: e.category,
            provider: e.provider,
            model: e.model ?? null,
            connector_key: e.connectorKey ?? null,
            agent_name: e.agentName ?? null,
            input_tokens: e.inputTokens ?? 0,
            output_tokens: e.outputTokens ?? 0,
            units: e.units ?? 0,
            amount_usd: e.amountUsd,
            metadata: e.metadata ?? {},
          })
          .select("id")
          .single(),
        "record cost",
      );
    },
    async spendSince(since) {
      const res = await db.rpc("org_spend_usd", { org, since: since.toISOString() });
      if (res.error) throw new Error(`spend: ${res.error.message}`);
      return Number(res.data ?? 0);
    },
    async spendByRun(runId) {
      const rows = must(await db.from("cost_ledger").select("amount_usd").eq("research_run_id", runId), "run spend") as Array<{ amount_usd: string | number }>;
      return rows.reduce((n, r) => n + Number(r.amount_usd), 0);
    },
    async getBudget() {
      const row = must(
        await db.from("organizations").select("per_run_budget_usd, daily_budget_usd, monthly_budget_usd").eq("id", org).single(),
        "budget",
      ) as Record<string, string | number>;
      return { perRunUsd: Number(row.per_run_budget_usd), dailyUsd: Number(row.daily_budget_usd), monthlyUsd: Number(row.monthly_budget_usd) };
    },
    async getScoringWeights() {
      const res = await db.from("scoring_settings").select("id, weights").eq("organization_id", org).eq("is_active", true).maybeSingle();
      if (res.error) throw new Error(res.error.message);
      return res.data
        ? { id: res.data.id as string, weights: res.data.weights as ScoringWeights }
        : { id: null, weights: DEFAULT_SCORING_WEIGHTS };
    },
    async getConnectorSettings() {
      const rows = must(await db.from("connectors").select("connector_key, enabled, compliance_status").eq("organization_id", org), "connector settings") as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        connectorKey: r.connector_key as string,
        enabled: r.enabled as boolean,
        complianceStatus: r.compliance_status as never,
      }));
    },
    async audit(action, entityType, entityId, metadata) {
      const res = await db.rpc("record_audit_event", {
        org,
        event_action: action,
        event_entity_type: entityType,
        event_entity_id: entityId ?? null,
        event_metadata: metadata ?? {},
      });
      if (res.error) throw new Error(`audit: ${res.error.message}`);
    },
  };

  return { research, evidence, signals, opportunities, ops };
}
