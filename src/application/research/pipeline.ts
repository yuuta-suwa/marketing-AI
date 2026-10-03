import { AgentRunner } from "@/application/agent-runner";
import { createBudgetTracker } from "@/application/budget";
import type { AppContext } from "@/application/context";
import type { ConnectorSetting } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";
import type { Evidence } from "@/domain/evidence/evidence";
import type { ResearchRunStats } from "@/domain/research/run";
import { isTerminalRunStatus, type ResearchRunStatus } from "@/domain/research/run-state-machine";
import { deduplicate } from "@/domain/source/dedup";
import { normalizeSourceItem } from "@/domain/source/normalize";
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
 * Executes one research run end to end:
 *   QUEUED → COLLECTING → NORMALIZING → EXTRACTING → CLUSTERING → ANALYZING → VALIDATING → COMPLETED
 * Connector failures degrade the run (PARTIAL_SUCCESS) instead of failing it.
 * Data persisted before a failure or budget stop is kept.
 */
export async function runResearchPipeline(
  ctx: AppContext,
  runId: string,
  input: { manualItems?: RawSourceItem[] } = {},
): Promise<PipelineResult> {
  authorize(ctx.actor, "research.create");
  const log = ctx.logger.child({ research_run_id: runId, organization_id: ctx.actor.organizationId });
  const run = await ctx.repos.research.getRun(runId);
  if (!run) throw new DomainError("NOT_FOUND", "Research run not found");
  if (isTerminalRunStatus(run.status)) throw new DomainError("CONFLICT", `Run already ${run.status}`);
  const directive = await ctx.repos.research.getDirective(run.directiveId);
  if (!directive) throw new DomainError("NOT_FOUND", "Directive not found");

  const stats: ResearchRunStats = {};
  let degraded = false;
  let status: ResearchRunStatus = run.status;
  const move = async (to: ResearchRunStatus, reason?: string) => {
    await ctx.repos.research.transitionRun(runId, to, {
      statusReason: reason ?? null,
      degraded,
      stats,
      costUsd: budget.spentThisRun,
    });
    status = to;
    log.info("run.transition", { status: to });
  };

  const budget = await createBudgetTracker(ctx, run.budgetLimitUsd);
  const runner = new AgentRunner({ ops: ctx.repos.ops, budget, logger: log, maxCallsPerAgent: ctx.options.maxCallsPerAgent });
  const qualityOf = (id: string) => ctx.connectors.get(id)?.sourceQuality ?? 0.3;
  const budgetStops: string[] = [];

  try {
    if (status === "DRAFT") await move("QUEUED");

    // ---- COLLECTING ------------------------------------------------------
    await move("COLLECTING");
    const settings: ConnectorSetting[] = await ctx.repos.ops.getConnectorSettings();
    const outcomes = await collectSources(ctx, {
      runId,
      directive,
      manualItems: input.manualItems,
      settings,
      budget,
    });
    stats.connectorsSucceeded = outcomes.filter((o) => o.status === "SUCCESS" || o.status === "PARTIAL").map((o) => o.connector.id);
    stats.connectorsFailed = outcomes.filter((o) => o.status === "FAILED").map((o) => o.connector.id);
    stats.connectorsSkipped = outcomes.filter((o) => o.status === "SKIPPED").map((o) => o.connector.id);
    if (stats.connectorsFailed.length > 0 || outcomes.some((o) => o.status === "PARTIAL")) degraded = true;

    const collected = outcomes.flatMap((o) => o.items.map((item) => ({ item, connectorId: o.connector.id })));
    if (collected.length === 0) {
      const reason =
        outcomes.length === 0
          ? "実行可能なConnectorがありません（手動インポートまたはConnector設定を確認してください）"
          : `データを取得できませんでした（失敗: ${stats.connectorsFailed.join(", ") || "なし"} / スキップ: ${stats.connectorsSkipped.join(", ") || "なし"}）`;
      await move("FAILED", reason);
      return { runId, status, reason, stats };
    }

    // ---- NORMALIZING -----------------------------------------------------
    await move("NORMALIZING");
    const retrievedAt = ctx.clock.now().toISOString();
    const normalized = collected.map(({ item, connectorId }) =>
      normalizeSourceItem(item, {
        researchRunId: runId,
        connectorId,
        retrievedAt,
        complianceStatus: connectorId === "manual_import" ? "MANUAL_UPLOAD" : "APPROVED",
        hash: ctx.hash,
      }),
    );
    const existing = await ctx.repos.evidence.listSourceItems(runId);
    const { unique, duplicates } = deduplicate(normalized, { existing });
    const sourceItems = await ctx.repos.evidence.insertSourceItems(unique);
    stats.sourceItems = sourceItems.length;
    stats.duplicates = duplicates.length;

    // ---- EXTRACTING ------------------------------------------------------
    await move("EXTRACTING");
    const evidence = await ctx.repos.evidence.insertEvidence(buildEvidence(sourceItems, qualityOf));
    stats.evidence = evidence.length;
    if (evidence.length === 0) {
      await move("PARTIAL_SUCCESS", "不満・要望などのシグナルを含む記述が見つかりませんでした");
      return { runId, status, reason: "no evidence", stats };
    }
    const extraction = await extractSignals(ctx, runner, { runId, directive, evidence });
    budgetStops.push(...extraction.budgetStops);
    stats.signals = extraction.signals.length;
    if (extraction.rejected > 0) {
      degraded = true;
      log.warn("signals.rejected", { result_count: extraction.rejected });
    }
    if (extraction.signals.length === 0) {
      await move("PARTIAL_SUCCESS", "Evidenceは保存しましたが、シグナルは抽出されませんでした");
      return { runId, status, stats };
    }

    // ---- CLUSTERING ------------------------------------------------------
    await move("CLUSTERING");
    const embedded = await embedSignals(ctx, { runId, signals: extraction.signals, budget });
    if (embedded.budgetStop) budgetStops.push(embedded.budgetStop);
    const evidenceMap = new Map<string, Evidence>(evidence.map((e) => [e.id, e]));
    const sourceMap = new Map<string, SourceItem>(sourceItems.map((s) => [s.id, s]));
    const clusters = await buildClusters(ctx, {
      runId,
      signals: extraction.signals,
      vectors: embedded.vectors,
      evidence: evidenceMap,
      sourceItems: sourceMap,
      qualityOf,
    });
    stats.clusters = clusters.length;

    // ---- ANALYZING -------------------------------------------------------
    await move("ANALYZING");
    const generated = await generateOpportunities(ctx, runner, {
      runId,
      directive,
      clusters,
      signals: new Map(extraction.signals.map((s) => [s.id, s])),
      evidence: evidenceMap,
      sourceItems: sourceMap,
      qualityOf,
    });
    budgetStops.push(...generated.budgetStops);
    stats.opportunities = generated.opportunities.length;

    // ---- VALIDATING ------------------------------------------------------
    await move("VALIDATING");
    for (const o of generated.opportunities) {
      const linked = await ctx.repos.opportunities.listOpportunityEvidenceIds(o.id);
      if (linked.length === 0) throw new DomainError("EVIDENCE_INTEGRITY", `Opportunity ${o.id} has no evidence`);
    }
    if (budgetStops.length > 0) {
      stats.budgetStops = budgetStops;
      degraded = true;
    }
    const final: ResearchRunStatus = degraded ? "PARTIAL_SUCCESS" : "COMPLETED";
    const reason = degraded
      ? [
          stats.connectorsFailed?.length ? `失敗したConnector: ${stats.connectorsFailed.join(", ")}` : null,
          ...budgetStops,
        ]
          .filter(Boolean)
          .join(" / ") || "一部の処理が縮退実行されました"
      : undefined;
    await move(final, reason);
    await ctx.repos.ops.audit("research.completed", "research_run", runId, { status: final, stats });
    return { runId, status, reason, stats };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error("run.failed", { error: message, status: "FAILED" });
    if (!isTerminalRunStatus(status)) {
      try {
        await move("FAILED", message.slice(0, 500));
      } catch (inner) {
        log.error("run.fail_transition_failed", { error: (inner as Error).message });
      }
    }
    return { runId, status: "FAILED", reason: message, stats };
  }
}
