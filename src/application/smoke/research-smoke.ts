import type { AppContext } from "@/application/context";
import type { JobWorker } from "@/application/jobs/worker";
import { LocalFridayAdapter } from "@/application/executive/local-friday";
import { runRedTeam } from "@/application/opportunity/red-team";
import { checkEvidenceChain, type ChainReport } from "@/application/integrity/evidence-chain";
import { createResearch } from "@/application/research/create-research";
import { dispatchResearch } from "@/application/research/dispatch";

export const SMOKE_QUERY = "日本の旅行市場で、利用者が感じている不満・不便・不足から新規事業機会を探して";

export type SmokeStep = { step: string; ok: boolean; detail: string };
export type SmokeReport = {
  query: string;
  runId: string | null;
  finalStatus: string | null;
  steps: SmokeStep[];
  /** Connectors whose data was synthetic (MOCK). A live proof requires none. */
  mockSources: string[];
  liveSources: string[];
  opportunities: Array<{ id: string; title: string; score: number | null; confidence: string; redTeam: string | null }>;
  integrity: ChainReport | null;
  ok: boolean;
};

/**
 * The real research scenario, end to end, through the same production path:
 * Directive → Queue → Worker → sources → Evidence → Signal → Cluster →
 * Opportunities → Score → Confidence → Red Team → FRIDAY. Nothing is
 * hardcoded: every check reads what the pipeline actually persisted.
 */
export async function runResearchSmoke(
  ctx: AppContext,
  worker: JobWorker,
  options: { query?: string; minOpportunities?: number; maxJobs?: number } = {},
): Promise<SmokeReport> {
  const query = options.query ?? SMOKE_QUERY;
  const steps: SmokeStep[] = [];
  const check = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });
  const report: SmokeReport = { query, runId: null, finalStatus: null, steps, mockSources: [], liveSources: [], opportunities: [], integrity: null, ok: false };

  const { run, parser } = await createResearch(ctx, { input: query, sourcePreferences: [] });
  report.runId = run.id;
  const directive = await ctx.repos.research.getDirective(run.directiveId);
  check("Directive", Boolean(directive), `parser=${parser} keywords=${directive?.keywords.join(", ") ?? "—"}`);

  const dispatched = await dispatchResearch(ctx, run.id);
  check("Queue", dispatched.jobStatus === "QUEUED", `job ${dispatched.jobId} ${dispatched.jobStatus}`);

  const processed = await worker.drain(options.maxJobs ?? 20);
  const jobs = await ctx.repos.jobs.list({ researchRunId: run.id });
  check("Worker", processed >= 1 && jobs.every((j) => j.status === "COMPLETED"), `${processed} job(s): ${jobs.map((j) => `${j.jobType}=${j.status}`).join(", ")}`);

  const final = await ctx.repos.research.getRun(run.id);
  report.finalStatus = final?.status ?? null;
  const items = await ctx.repos.evidence.listSourceItems(run.id);
  const byConnector = new Map<string, { synthetic: boolean; count: number }>();
  for (const s of items) {
    const synthetic = s.metadata?.synthetic === true;
    const cur = byConnector.get(s.connectorId) ?? { synthetic, count: 0 };
    byConnector.set(s.connectorId, { synthetic: cur.synthetic || synthetic, count: cur.count + 1 });
  }
  report.mockSources = [...byConnector].filter(([, v]) => v.synthetic).map(([k]) => k);
  report.liveSources = [...byConnector].filter(([, v]) => !v.synthetic).map(([k]) => k);
  const webOrStat = items.filter((s) => s.connectorId === "web_search" || s.connectorId === "estat").length;
  check("Web/e-Stat Source", webOrStat > 0, `${items.length} item(s): ${[...byConnector].map(([k, v]) => `${k}=${v.count}${v.synthetic ? "(MOCK)" : ""}`).join(", ") || "none"}`);

  const evidence = await ctx.repos.evidence.listEvidence({ runId: run.id });
  check("Evidence", evidence.length > 0, `${evidence.length} verbatim excerpt(s)`);
  const signals = await ctx.repos.signals.listSignals({ runId: run.id, limit: 5000 });
  check("Signal", signals.length > 0, `${signals.length} signal(s)`);
  const clusters = await ctx.repos.signals.listClusters({ runId: run.id });
  check("Cluster", clusters.length > 0, `${clusters.length} cluster(s)`);
  const opps = await ctx.repos.opportunities.listOpportunities({ runId: run.id });
  const min = options.minOpportunities ?? 3;
  check(`Minimum ${min} Opportunities`, opps.length >= min, `${opps.length} opportunit${opps.length === 1 ? "y" : "ies"}`);

  let scored = 0;
  for (const o of opps) {
    const score = await ctx.repos.opportunities.latestScore(o.id);
    if (score) scored++;
    let verdict: string | null = null;
    try {
      verdict = (await runRedTeam(ctx, o.id)).verdict;
    } catch (e) {
      verdict = `ERROR: ${(e as Error).message}`;
    }
    report.opportunities.push({ id: o.id, title: o.title, score: o.scoreTotal, confidence: o.confidence, redTeam: verdict });
  }
  check("Score", opps.length > 0 && scored === opps.length, `${scored}/${opps.length} scored`);
  check("Confidence", opps.length > 0 && opps.every((o) => ["LOW", "MEDIUM", "HIGH"].includes(o.confidence)), opps.map((o) => o.confidence).join(", ") || "—");
  check("Red Team", report.opportunities.length > 0 && report.opportunities.every((o) => o.redTeam && !o.redTeam.startsWith("ERROR")), report.opportunities.map((o) => o.redTeam).join(", ") || "—");

  if (opps[0]) {
    const briefing = await new LocalFridayAdapter(ctx).consult(opps[0].id);
    check("FRIDAY", Boolean(briefing.recommendedNextAction), `${briefing.headline}: ${briefing.recommendedNextAction}`);
  } else {
    check("FRIDAY", false, "no opportunity to brief");
  }

  report.integrity = await checkEvidenceChain(ctx, { runId: run.id });
  check("Evidence chain", report.integrity.ok, report.integrity.ok ? `${report.integrity.checkedOpportunities} opportunit(ies) traced to source URLs` : report.integrity.violations.slice(0, 5).join(" | "));

  report.ok = steps.every((s) => s.ok);
  return report;
}
