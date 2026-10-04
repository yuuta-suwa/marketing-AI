import type { AppContext } from "@/application/context";
import { compareOpportunityBusinessModels, runCfoAnalysis } from "@/application/analysis/business-model";
import { LocalFridayAdapter } from "@/application/executive/local-friday";
import { runRedTeam } from "@/application/opportunity/red-team";
import { createResearch } from "@/application/research/create-research";
import { dispatchResearch } from "@/application/research/dispatch";
import { isTerminalRunStatus } from "@/domain/research/run-state-machine";
import { computeGoldenRunMetrics, type GoldenRunMetrics } from "./metrics";

export const GOLDEN_QUERY =
  "日本の旅行市場で、旅行者が感じている不満・不便・不足・既存サービスへの要望から、新しい事業機会を調査してください。特に、現在の解決方法では十分に満たされていない課題と、利用者がお金を払ってでも解決したい可能性がある課題を優先してください。";

export type GoldenStage = { stage: string; ok: boolean; detail: string };
export type GoldenRunResult = {
  status: "LIVE_VALIDATION_FAILED" | "LIVE_VALIDATION_PARTIAL" | "MVP_LIVE_VALIDATED";
  runId: string | null;
  stages: GoldenStage[];
  metrics: GoldenRunMetrics | null;
  fridayContext: { headline: string; recommendedNextAction: string; unknowns: string[] } | null;
  startedAt: string;
  finishedAt: string;
};

export type GoldenRunOptions = {
  query?: string;
  /** Advances the queue until the run's jobs are done: an inline worker drain, or polling a deployed worker. */
  advanceQueue: (runId: string) => Promise<void>;
  /** Live connectors that must contribute data (default: web_search, estat). */
  requiredSources?: string[];
  maxOpportunitiesToAnalyse?: number;
};

/**
 * One end-to-end live research run through the production path. Nothing is
 * hardcoded; every stage is checked against persisted data. The run fails
 * validation if any source item is synthetic (MOCK).
 */
export async function runGoldenResearch(ctx: AppContext, options: GoldenRunOptions): Promise<GoldenRunResult> {
  const startedAt = ctx.clock.now().toISOString();
  const stages: GoldenStage[] = [];
  const check = (stage: string, ok: boolean, detail: string) => stages.push({ stage, ok, detail });
  const finish = (runId: string | null, metrics: GoldenRunMetrics | null, friday: GoldenRunResult["fridayContext"]): GoldenRunResult => {
    const required = new Set(["ResearchDirective", "ResearchRun", "Queue", "Worker", "SourceItems", "Evidence", "Market Signals", "Opportunities", "No MOCK sources", "Evidence chain"]);
    const requiredOk = stages.filter((s) => required.has(s.stage)).every((s) => s.ok);
    const allOk = stages.every((s) => s.ok);
    return {
      status: allOk ? "MVP_LIVE_VALIDATED" : requiredOk ? "LIVE_VALIDATION_PARTIAL" : "LIVE_VALIDATION_FAILED",
      runId,
      stages,
      metrics,
      fridayContext: friday,
      startedAt,
      finishedAt: ctx.clock.now().toISOString(),
    };
  };

  const { run, parser } = await createResearch(ctx, { input: options.query ?? GOLDEN_QUERY, deepResearch: true });
  const directive = await ctx.repos.research.getDirective(run.directiveId);
  check("ResearchDirective", Boolean(directive), `parser=${parser}; keywords=${directive?.keywords.join(", ") ?? "—"}`);
  check("ResearchRun", run.status === "QUEUED", `${run.id} ${run.status}`);
  const dispatched = await dispatchResearch(ctx, run.id);
  check("Queue", dispatched.jobStatus === "QUEUED", `job ${dispatched.jobId}`);

  await options.advanceQueue(run.id);
  const done = await ctx.repos.research.getRun(run.id);
  const jobs = await ctx.repos.jobs.list({ researchRunId: run.id, limit: 50 });
  check(
    "Worker",
    Boolean(done && isTerminalRunStatus(done.status)) && jobs.length >= 1 && jobs.every((j) => j.status === "COMPLETED"),
    `${done?.status ?? "?"}; ${jobs.map((j) => `${j.jobType}=${j.status}#${j.attemptCount}`).join(", ")}`,
  );
  if (!done || !isTerminalRunStatus(done.status)) return finish(run.id, null, null);

  // Analyses on the generated opportunities (Business Model → CFO → Red Team), then the worker re-scores.
  const opps = await ctx.repos.opportunities.listOpportunities({ runId: run.id });
  const analysed = opps.slice(0, options.maxOpportunitiesToAnalyse ?? 5);
  let bm = 0;
  let cfo = 0;
  let red = 0;
  const analysisErrors: string[] = [];
  for (const o of analysed) {
    try {
      if ((await compareOpportunityBusinessModels(ctx, o.id)).length > 0) bm++;
      await runCfoAnalysis(ctx, { opportunityId: o.id });
      cfo++;
      await runRedTeam(ctx, o.id);
      red++;
    } catch (e) {
      analysisErrors.push(`${o.id}: ${(e as Error).message}`);
    }
  }
  await options.advanceQueue(run.id);

  const metrics = await computeGoldenRunMetrics(ctx, run.id);
  const required = options.requiredSources ?? ["web_search", "estat"];
  const live = metrics.connectorsUsed.filter((c) => !metrics.mockSources.includes(c));
  check("Brave / e-Stat", required.some((r) => live.includes(r)), `live sources: ${live.join(", ") || "none"} (required any of ${required.join(", ")})`);
  check("No MOCK sources", metrics.mockSources.length === 0 && metrics.evidenceQuality.mockSourceRate !== null && metrics.evidenceQuality.mockSourceRate === 0, `mock: ${metrics.mockSources.join(", ") || "none"}`);
  check("SourceItems", metrics.counts.sourceItems > 0, `${metrics.counts.sourceItems} (duplicates removed ${metrics.counts.duplicatesRemoved})`);
  check("Evidence", metrics.counts.evidence > 0, `${metrics.counts.evidence}`);
  check("Market Signals", metrics.counts.signals > 0, `${metrics.counts.signals}`);
  check("Signal Clusters", metrics.counts.clusters > 0, `${metrics.counts.clusters}`);
  check("Opportunities", metrics.counts.opportunities > 0, `${metrics.counts.opportunities}`);
  check("Opportunity Score", metrics.reviewTable.length > 0 && metrics.reviewTable.every((r) => r.opportunityScore !== null), metrics.reviewTable.map((r) => r.opportunityScore).join(", ") || "—");
  check("Evidence Confidence", metrics.reviewTable.length > 0, metrics.reviewTable.map((r) => r.evidenceConfidence).join(", ") || "—");
  check("Business Model", analysed.length > 0 && bm === analysed.length, `${bm}/${analysed.length}`);
  check("CFO Analysis", analysed.length > 0 && cfo === analysed.length, `${cfo}/${analysed.length}${analysisErrors.length ? `; errors: ${analysisErrors.join(" | ")}` : ""}`);
  check("Red Team", analysed.length > 0 && red === analysed.length, `${red}/${analysed.length}`);
  check("Evidence chain", metrics.integrity.ok && metrics.evidenceQuality.opportunityEvidenceCoverage === 1, metrics.integrity.ok ? `${metrics.integrity.checkedOpportunities} opportunities traced` : metrics.integrity.violations.slice(0, 5).join(" | "));

  let friday: GoldenRunResult["fridayContext"] = null;
  if (opps[0]) {
    const b = await new LocalFridayAdapter(ctx).consult(opps[0].id);
    friday = { headline: b.headline, recommendedNextAction: b.recommendedNextAction, unknowns: b.unknowns };
  }
  check("FRIDAY Context", Boolean(friday), friday ? `${friday.headline} → ${friday.recommendedNextAction}` : "no opportunity");
  return finish(run.id, metrics, friday);
}
