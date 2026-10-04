import { AgentRunner } from "@/application/agent-runner";
import { createBudgetTracker } from "@/application/budget";
import { RunCounter } from "@/application/limits";
import { incorporateAdditionalResearch } from "@/application/opportunity/incorporate";
import type { AppContext } from "@/application/context";
import type { ConnectorSetting } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";
import type { Evidence } from "@/domain/evidence/evidence";
import type { JobType } from "@/domain/jobs/job";
import { looksLikePromptInjection } from "@/domain/agent/prompt-boundary";
import { RUN_ACTION_JA, progressFor, stageReached } from "@/domain/research/progress";
import type { ResearchRun, ResearchRunStats } from "@/domain/research/run";
import { isTerminalRunStatus, type ResearchRunStatus } from "@/domain/research/run-state-machine";
import { deduplicate } from "@/domain/source/dedup";
import { enrichLocale, normalizeSourceItem } from "@/domain/source/normalize";
import type { RawSourceItem, SourceItem } from "@/domain/source/source-item";
import { DomainError } from "@/domain/shared/errors";
import { collectSources } from "./collect";
import { buildEvidence } from "./evidence-builder";
import { buildClusters, embedSignals } from "./stages/cluster-signals";
import { extractSignals } from "./stages/extract-signals";
import { generateOpportunities } from "./stages/generate-opportunities";

export type PipelineResult = {
  runId: string;
  status: ResearchRunStatus;
  reason?: string;
  stats: ResearchRunStats;
};

/**
 * The research pipeline is split into four resumable stages. In production
 * each stage is one background job (chained by the worker); tests and the
 * inline fallback run them back to back with runResearchPipeline().
 *
 *   COLLECTION              QUEUED → COLLECTING → NORMALIZING   (source items)
 *   SIGNAL_EXTRACTION       → EXTRACTING                         (evidence, signals)
 *   CLUSTER_GENERATION      → CLUSTERING                         (embeddings, clusters)
 *   OPPORTUNITY_GENERATION  → ANALYZING → VALIDATING → COMPLETED / PARTIAL_SUCCESS
 *
 * Idempotency (a job may be delivered twice or re-run after a worker died):
 *   * a stage whose checkpoint is recorded is a no-op that only names the next stage;
 *   * source items and evidence are upserts on natural keys (run+hash, source+text);
 *   * partial signals/clusters of an interrupted attempt are discarded before re-running
 *     (each signal/cluster is written atomically with its links);
 *   * opportunities are unique per cluster; existing ones are reused, never duplicated.
 * Connector failures and hard limits degrade the run (PARTIAL_SUCCESS); data persisted
 * before a failure or a limit stop is kept.
 */
export const RESEARCH_STAGES = ["COLLECTION", "SIGNAL_EXTRACTION", "CLUSTER_GENERATION", "OPPORTUNITY_GENERATION"] as const;
export type ResearchStage = (typeof RESEARCH_STAGES)[number];

export const STAGE_JOB_TYPE: Record<ResearchStage, JobType> = {
  COLLECTION: "RESEARCH_COLLECTION",
  SIGNAL_EXTRACTION: "SIGNAL_EXTRACTION",
  CLUSTER_GENERATION: "CLUSTER_GENERATION",
  OPPORTUNITY_GENERATION: "OPPORTUNITY_GENERATION",
};

export const JOB_TYPE_STAGE: Partial<Record<JobType, ResearchStage>> = Object.fromEntries(
  RESEARCH_STAGES.map((s) => [STAGE_JOB_TYPE[s], s]),
) as Partial<Record<JobType, ResearchStage>>;

const NEXT_STAGE: Record<ResearchStage, ResearchStage | null> = {
  COLLECTION: "SIGNAL_EXTRACTION",
  SIGNAL_EXTRACTION: "CLUSTER_GENERATION",
  CLUSTER_GENERATION: "OPPORTUNITY_GENERATION",
  OPPORTUNITY_GENERATION: null,
};

/** Statuses a run is in while a stage is executing. */
const STAGE_STATUSES: Record<ResearchStage, readonly ResearchRunStatus[]> = {
  COLLECTION: ["COLLECTING", "NORMALIZING"],
  SIGNAL_EXTRACTION: ["EXTRACTING"],
  CLUSTER_GENERATION: ["CLUSTERING"],
  OPPORTUNITY_GENERATION: ["ANALYZING", "VALIDATING"],
};

/** Checkpoint names written to run.stats.checkpoints when a stage's output is complete. */
const CHECKPOINT: Record<ResearchStage, string> = {
  COLLECTION: "collection",
  SIGNAL_EXTRACTION: "signals",
  CLUSTER_GENERATION: "clusters",
  OPPORTUNITY_GENERATION: "opportunities",
};

export type StageInput = {
  manualItems?: RawSourceItem[];
  manualUrls?: string[];
  /**
   * Called between units of work. The worker uses it to renew its lease and
   * throws when the job was lost or cancelled, so the stage stops early.
   */
  checkpoint?: () => Promise<void>;
};

export type StageResult = PipelineResult & { next: ResearchStage | null };

/** Run-scoped execution state shared by the helpers of one stage. */
class StageRun {
  stats: ResearchRunStats;
  degraded: boolean;
  status: ResearchRunStatus;

  constructor(
    private readonly ctx: AppContext,
    readonly run: ResearchRun,
    private readonly spent: () => number,
  ) {
    this.stats = { ...run.stats, checkpoints: [...(run.stats.checkpoints ?? [])] };
    this.degraded = run.degraded;
    this.status = run.status;
  }

  has(checkpoint: string): boolean {
    return this.stats.checkpoints?.includes(checkpoint) ?? false;
  }

  /** Moves forward; already-reached stages are skipped (resume). */
  async move(to: ResearchRunStatus, reason?: string): Promise<void> {
    if (to !== "FAILED" && to !== "CANCELLED" && stageReached(this.status, to) && !isTerminalRunStatus(to)) return;
    await this.ctx.repos.research.transitionRun(this.run.id, to, {
      statusReason: reason ?? null,
      degraded: this.degraded,
      stats: this.stats,
      costUsd: this.spent(),
    });
    this.status = to;
    this.ctx.logger.info("run.transition", { research_run_id: this.run.id, status: to });
  }

  /** Persists stats/progress without changing the status. */
  async progress(withinStage: number, action?: string): Promise<void> {
    await this.ctx.repos.research.transitionRun(this.run.id, this.status, {
      stats: this.stats,
      degraded: this.degraded,
      costUsd: this.spent(),
      progressPercent: progressFor(this.status, withinStage),
      currentAction: action ?? RUN_ACTION_JA[this.status],
    });
  }

  async mark(checkpoint: string): Promise<void> {
    if (!this.has(checkpoint)) this.stats.checkpoints = [...(this.stats.checkpoints ?? []), checkpoint];
    await this.progress(1);
  }

  addStops(field: "budgetStops" | "limitStops", reasons: readonly string[]): void {
    if (reasons.length === 0) return;
    this.stats[field] = [...new Set([...(this.stats[field] ?? []), ...reasons])];
    this.degraded = true;
  }
}

async function loadRunContext(ctx: AppContext, runId: string) {
  authorize(ctx.actor, "research.create");
  const run = await ctx.repos.research.getRun(runId);
  if (!run) throw new DomainError("NOT_FOUND", "Research run not found");
  const directive = await ctx.repos.research.getDirective(run.directiveId);
  if (!directive) throw new DomainError("NOT_FOUND", "Directive not found");
  return { run, directive };
}

function finalReason(stats: ResearchRunStats): string {
  return (
    [
      stats.connectorsFailed?.length ? `失敗したConnector: ${stats.connectorsFailed.join(", ")}` : null,
      ...(stats.limitStops ?? []),
      ...(stats.budgetStops ?? []),
    ]
      .filter(Boolean)
      .join(" / ") || "一部の処理が縮退実行されました"
  );
}

/**
 * Executes ONE stage of a research run. Safe to call repeatedly for the same
 * stage: completed work is detected and never repeated or duplicated.
 */
export async function runResearchStage(ctx: AppContext, runId: string, stage: ResearchStage, input: StageInput = {}): Promise<StageResult> {
  const { run, directive } = await loadRunContext(ctx, runId);
  const log = ctx.logger.child({ research_run_id: runId, organization_id: ctx.actor.organizationId, stage });
  if (isTerminalRunStatus(run.status)) {
    log.info("stage.skip_terminal", { status: run.status });
    return { runId, status: run.status, stats: run.stats, next: null, reason: run.statusReason ?? undefined };
  }

  const budget = await createBudgetTracker(ctx, run.budgetLimitUsd, run.costUsd);
  const state = new StageRun(ctx, run, () => budget.spentThisRun);
  const tick = async () => input.checkpoint?.();

  if (state.has(CHECKPOINT[stage])) {
    log.info("stage.already_done");
    return { runId, status: state.status, stats: state.stats, next: NEXT_STAGE[stage] };
  }
  // The run already sits in this stage's own status without its checkpoint:
  // an earlier attempt died mid-stage and this is a resume.
  if (STAGE_STATUSES[stage].includes(run.status)) {
    state.stats.resumed = (state.stats.resumed ?? 0) + 1;
    log.warn("stage.resumed", { status: run.status, retry_count: state.stats.resumed });
  }

  // LLM call cap is run-wide: count paid calls made by earlier stages.
  const priorLlmCalls =
    (await ctx.repos.ops.listAgentRuns({ runId })).filter((a) => a.provider !== "heuristic").length + (directive.parser === "ai" ? 1 : 0);
  const llmCalls = new RunCounter("LLM呼び出し回数", ctx.options.limits.maxLlmCallsPerRun, priorLlmCalls);
  const runner = new AgentRunner({ ops: ctx.repos.ops, budget, logger: log, maxCallsPerAgent: ctx.options.maxCallsPerAgent, llmCalls });
  const qualityOf = (id: string) => ctx.connectors.get(id)?.sourceQuality ?? 0.3;
  const done = (next: ResearchStage | null): StageResult => ({ runId, status: state.status, stats: state.stats, next });
  const end = async (to: "PARTIAL_SUCCESS" | "FAILED", primary: string): Promise<StageResult> => {
    // Keep the root causes visible (failed connectors, limits) — not only the symptom.
    const causes = state.degraded && (state.stats.connectorsFailed?.length || state.stats.limitStops?.length || state.stats.budgetStops?.length) ? finalReason(state.stats) : null;
    const reason = causes && !primary.includes("失敗:") ? `${primary} / ${causes}` : primary;
    await state.move(to, reason);
    await ctx.repos.ops.audit("research.completed", "research_run", runId, { status: to, stats: state.stats });
    return { runId, status: to, reason, stats: state.stats, next: null };
  };

  try {
    switch (stage) {
      // ---- COLLECTION ----------------------------------------------------
      case "COLLECTION": {
        if (state.status === "DRAFT") await state.move("QUEUED");
        const existing = await ctx.repos.evidence.listSourceItems(runId);
        if (existing.length === 0) {
          if (!stageReached(state.status, "COLLECTING")) {
            await state.move("COLLECTING");
            await ctx.repos.ops.audit("research.started", "research_run", runId, { runType: run.runType });
          }
          const settings: ConnectorSetting[] = await ctx.repos.ops.getConnectorSettings();
          const externalRequests = new RunCounter("検索・外部APIリクエスト数", ctx.options.limits.maxSearchRequestsPerRun);
          const outcomes = await collectSources(ctx, {
            runId,
            directive,
            manualItems: input.manualItems,
            manualUrls: input.manualUrls,
            settings,
            budget,
            externalRequests,
          });
          await tick();
          state.stats.connectorsSucceeded = outcomes.filter((o) => o.status === "SUCCESS" || o.status === "PARTIAL").map((o) => o.connector.id);
          state.stats.connectorsFailed = outcomes.filter((o) => o.status === "FAILED" && !o.limitStop).map((o) => o.connector.id);
          state.stats.connectorsSkipped = outcomes.filter((o) => o.status === "SKIPPED" || o.limitStop).map((o) => o.connector.id);
          state.addStops("limitStops", [...new Set(outcomes.flatMap((o) => (o.limitStop ? [o.limitStop] : [])))]);
          if (state.stats.connectorsFailed.length > 0 || outcomes.some((o) => o.status === "PARTIAL")) state.degraded = true;

          const collected = outcomes.flatMap((o) => o.items.map((item) => ({ item, connectorId: o.connector.id })));
          if (collected.length === 0) {
            const reason =
              outcomes.length === 0
                ? "実行可能なConnectorがありません（手動インポートまたはConnector設定を確認してください）"
                : `データを取得できませんでした（失敗: ${state.stats.connectorsFailed.join(", ") || "なし"} / スキップ: ${state.stats.connectorsSkipped.join(", ") || "なし"}）`;
            return await end("FAILED", reason);
          }

          await state.move("NORMALIZING");
          const retrievedAt = ctx.clock.now().toISOString();
          const normalized = collected.map(({ item, connectorId }) => {
            // Untrusted content is stored as market data; suspicious instructions are only flagged.
            const flagged = looksLikePromptInjection(`${item.title ?? ""}\n${item.body}`);
            const tagged = flagged ? { ...item, metadata: { ...item.metadata, promptInjectionSuspected: true } } : item;
            return enrichLocale(
              normalizeSourceItem(tagged, {
                researchRunId: runId,
                connectorId,
                retrievedAt,
                complianceStatus: connectorId === "manual_import" ? "MANUAL_UPLOAD" : "APPROVED",
                hash: ctx.hash,
              }),
              directive,
            );
          });
          const { unique, duplicates } = deduplicate(normalized, { existing: [] });
          const cap = ctx.options.limits.maxSourceItemsPerRun;
          if (unique.length > cap) {
            state.addStops("limitStops", [`ソース件数の上限（${cap}件）を超えた${unique.length - cap}件を保存しませんでした`]);
          }
          const sourceItems = await ctx.repos.evidence.insertSourceItems(unique.slice(0, cap));
          state.stats.sourceItems = sourceItems.length;
          state.stats.duplicates = duplicates.length;
        } else {
          // Resume: the previous attempt already stored source items (single upsert).
          await state.move("NORMALIZING");
          state.stats.sourceItems = existing.length;
        }
        await state.mark(CHECKPOINT.COLLECTION);
        return done("SIGNAL_EXTRACTION");
      }

      // ---- SIGNAL_EXTRACTION ---------------------------------------------
      case "SIGNAL_EXTRACTION": {
        await state.move("EXTRACTING");
        let evidence = await ctx.repos.evidence.listEvidence({ runId });
        if (!state.has("evidence")) {
          const sourceItems = await ctx.repos.evidence.listSourceItems(runId);
          await ctx.repos.evidence.insertEvidence(buildEvidence(sourceItems, qualityOf)); // idempotent
          evidence = await ctx.repos.evidence.listEvidence({ runId });
          state.stats.evidence = evidence.length;
          await state.mark("evidence");
        }
        if (evidence.length === 0) return await end("PARTIAL_SUCCESS", "不満・要望などのシグナルを含む記述が見つかりませんでした");
        await tick();

        const partial = await ctx.repos.signals.discardRunSignals(runId);
        if (partial > 0) log.warn("stage.discarded_partial_signals", { result_count: partial });
        const extraction = await extractSignals(ctx, runner, { runId, directive, evidence });
        state.addStops("budgetStops", extraction.budgetStops);
        state.addStops("limitStops", runner.limitStops);
        state.stats.signals = extraction.signals.length;
        if (extraction.rejected > 0) {
          state.degraded = true;
          log.warn("signals.rejected", { result_count: extraction.rejected });
        }
        if (extraction.signals.length === 0) return await end("PARTIAL_SUCCESS", "Evidenceは保存しましたが、シグナルは抽出されませんでした");
        await state.mark(CHECKPOINT.SIGNAL_EXTRACTION);
        return done("CLUSTER_GENERATION");
      }

      // ---- CLUSTER_GENERATION --------------------------------------------
      case "CLUSTER_GENERATION": {
        await state.move("CLUSTERING");
        const partial = await ctx.repos.signals.discardRunClusters(runId);
        if (partial > 0) log.warn("stage.discarded_partial_clusters", { result_count: partial });
        const [signals, evidence, sourceItems] = await Promise.all([
          ctx.repos.signals.listSignals({ runId, limit: 5000 }),
          ctx.repos.evidence.listEvidence({ runId }),
          ctx.repos.evidence.listSourceItems(runId),
        ]);
        const embedded = await embedSignals(ctx, { runId, signals, budget });
        if (embedded.budgetStop) state.addStops("budgetStops", [embedded.budgetStop]);
        await tick();
        const clusters = await buildClusters(ctx, {
          runId,
          signals,
          vectors: embedded.vectors,
          evidence: new Map<string, Evidence>(evidence.map((e) => [e.id, e])),
          sourceItems: new Map<string, SourceItem>(sourceItems.map((s) => [s.id, s])),
          qualityOf,
          runner,
        });
        state.addStops("limitStops", runner.limitStops);
        state.stats.clusters = clusters.length;
        await state.mark(CHECKPOINT.CLUSTER_GENERATION);
        return done("OPPORTUNITY_GENERATION");
      }

      // ---- OPPORTUNITY_GENERATION ----------------------------------------
      case "OPPORTUNITY_GENERATION": {
        await state.move("ANALYZING");
        const [clusters, signals, evidence, sourceItems, existing] = await Promise.all([
          ctx.repos.signals.listClusters({ runId, limit: 500 }),
          ctx.repos.signals.listSignals({ runId, limit: 5000 }),
          ctx.repos.evidence.listEvidence({ runId }),
          ctx.repos.evidence.listSourceItems(runId),
          ctx.repos.opportunities.listOpportunities({ runId, limit: 500 }),
        ]);
        // Additional research updates its originating opportunity instead of spawning new ones.
        const generated = run.opportunityId
          ? { opportunities: [], budgetStops: [], reused: 0 }
          : await generateOpportunities(ctx, runner, {
              runId,
              directive,
              clusters,
              signals: new Map(signals.map((s) => [s.id, s])),
              evidence: new Map(evidence.map((e) => [e.id, e])),
              sourceItems: new Map(sourceItems.map((s) => [s.id, s])),
              qualityOf,
              existing,
            });
        state.addStops("budgetStops", generated.budgetStops);
        state.addStops("limitStops", runner.limitStops);
        state.stats.opportunities = generated.opportunities.length;
        await tick();

        await state.move("VALIDATING");
        for (const o of generated.opportunities) {
          const linked = await ctx.repos.opportunities.listOpportunityEvidenceIds(o.id);
          if (linked.length === 0) throw new DomainError("EVIDENCE_INTEGRITY", `Opportunity ${o.id} has no evidence`);
        }
        if (run.opportunityId) {
          try {
            const { linked } = await incorporateAdditionalResearch(ctx, { ...run, status: state.status });
            state.stats.linkedToOpportunity = linked;
          } catch (e) {
            log.error("run.incorporate_failed", { error: (e as Error).message });
            state.addStops("budgetStops", [`Opportunity更新に失敗: ${(e as Error).message}`]);
          }
        }
        if (!state.stats.checkpoints?.includes(CHECKPOINT.OPPORTUNITY_GENERATION)) {
          state.stats.checkpoints = [...(state.stats.checkpoints ?? []), CHECKPOINT.OPPORTUNITY_GENERATION];
        }
        const final: ResearchRunStatus = state.degraded ? "PARTIAL_SUCCESS" : "COMPLETED";
        const reason = state.degraded ? finalReason(state.stats) : undefined;
        await state.move(final, reason);
        await ctx.repos.ops.audit("research.completed", "research_run", runId, { status: final, stats: state.stats });
        return { runId, status: final, reason, stats: state.stats, next: null };
      }
    }
  } catch (e) {
    // Re-thrown for the worker to retry; the run stays in its current stage.
    log.error("stage.failed", { error: e instanceof Error ? e.message : String(e), status: state.status });
    throw e;
  }
}

/** Marks a run FAILED (worker: attempts exhausted or non-retryable error). */
export async function failResearchRun(ctx: AppContext, runId: string, reason: string): Promise<void> {
  const run = await ctx.repos.research.getRun(runId);
  if (!run || isTerminalRunStatus(run.status)) return;
  await ctx.repos.research.transitionRun(runId, "FAILED", { statusReason: reason.slice(0, 500) });
  await ctx.repos.ops.audit("research.completed", "research_run", runId, { status: "FAILED", reason: reason.slice(0, 500) });
}

/**
 * Runs every stage in-process. Used by tests and as a library entry point;
 * production executes the stages as queued jobs (see application/jobs).
 * Errors that would make the worker retry are turned into FAILED here.
 */
export async function runResearchPipeline(
  ctx: AppContext,
  runId: string,
  input: { manualItems?: RawSourceItem[]; manualUrls?: string[] } = {},
): Promise<PipelineResult> {
  const first = await ctx.repos.research.getRun(runId);
  if (first && isTerminalRunStatus(first.status)) throw new DomainError("CONFLICT", `Run already ${first.status}`);
  let stage: ResearchStage | null = "COLLECTION";
  let result: StageResult | null = null;
  try {
    while (stage) {
      result = await runResearchStage(ctx, runId, stage, input);
      stage = result.next;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failResearchRun(ctx, runId, message).catch((inner) =>
      ctx.logger.error("run.fail_transition_failed", { research_run_id: runId, error: (inner as Error).message }),
    );
    return { runId, status: "FAILED", reason: message, stats: result?.stats ?? {} };
  }
  return { runId, status: result!.status, reason: result!.reason, stats: result!.stats };
}
