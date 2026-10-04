import type { GoldenRunResult } from "./golden-run";

const pct = (x: number | null) => (x === null ? "— (pending)" : `${(x * 100).toFixed(1)}%`);
const usd = (x: number | null) => (x === null ? "— (pending)" : `$${x.toFixed(4)}`);
const cell = (s: string | number | null | undefined) => String(s ?? "—").replace(/\|/g, "／").replace(/\s+/g, " ").slice(0, 160);

/**
 * Renders the Golden Run record (docs/GOLDEN_RESEARCH_RUN.md format).
 * Human Rating / Human Decision are filled in the app (quality review) and the
 * report is regenerated; they are never produced by the system.
 */
export function renderGoldenRunReport(r: GoldenRunResult, meta: { appEnv: string; version: string; workerMode: string }): string {
  const m = r.metrics;
  const lines: string[] = [];
  lines.push(`# Golden Research Run — ${r.status}`, "");
  lines.push(`| Field | Value |`, `| --- | --- |`);
  lines.push(`| Research question | ${cell(m?.question)} |`);
  lines.push(`| Date | ${r.startedAt} |`);
  lines.push(`| Run ID | \`${r.runId ?? "—"}\` |`);
  lines.push(`| Environment | APP_ENV=${meta.appEnv} · version ${meta.version} · worker ${meta.workerMode} |`);
  lines.push(`| Duration | ${m?.durationSeconds ?? "—"} s (pipeline) |`);
  lines.push(`| Real connectors used | ${m?.connectorsUsed.filter((c) => !m.mockSources.includes(c)).join(", ") || "—"} |`);
  lines.push(`| MOCK sources | ${m?.mockSources.join(", ") || "none"} |`);
  if (m) {
    lines.push(`| SourceItems | ${m.counts.sourceItems} |`);
    lines.push(`| Deduplicated (removed) | ${m.counts.duplicatesRemoved} |`);
    lines.push(`| Evidence | ${m.counts.evidence} |`);
    lines.push(`| Signals | ${m.counts.signals} |`);
    lines.push(`| Clusters | ${m.counts.clusters} |`);
    lines.push(`| Opportunities | ${m.counts.opportunities} |`);
    lines.push(`| Total API calls (connectors incl. retries + LLM) | ${m.counts.apiCalls} |`);
    lines.push(`| LLM calls | ${m.counts.llmCalls} |`);
    lines.push(`| Estimated cost | $${m.cost.totalUsd.toFixed(4)} |`);
    lines.push(`| Retries | ${m.counts.retries} |`);
    lines.push(`| Final status | ${m.status}${m.statusReason ? ` — ${cell(m.statusReason)}` : ""} |`);
  }
  lines.push("", "## Pipeline stages", "", "| Stage | OK | Detail |", "| --- | --- | --- |");
  for (const s of r.stages) lines.push(`| ${s.stage} | ${s.ok ? "✅" : "❌"} | ${cell(s.detail)} |`);
  if (!m) return lines.join("\n");

  lines.push("", "## Errors and partial failures", "");
  lines.push(...(m.errors.length ? m.errors.map((e) => `- ${e}`) : ["- none"]));
  lines.push(...m.partialFailures.map((e) => `- (partial) ${e}`));

  const q = m.evidenceQuality;
  lines.push("", "## Evidence quality", "", "| Metric | Value |", "| --- | --- |");
  lines.push(`| Cross-source evidence rate | ${pct(q.crossSourceEvidenceRate)} |`);
  lines.push(`| Evidence with valid source URL | ${pct(q.validSourceUrlRate)} |`);
  lines.push(`| High-confidence evidence rate | ${pct(q.highConfidenceEvidenceRate)} |`);
  lines.push(`| Fresh evidence rate (≤ 365 days) | ${pct(q.freshEvidenceRate)} |`);
  lines.push(`| Duplicate removal rate | ${pct(q.duplicateRemovalRate)} |`);
  lines.push(`| Opportunity evidence coverage | ${pct(q.opportunityEvidenceCoverage)} |`);
  lines.push(`| Mock source rate | ${pct(q.mockSourceRate)} |`);
  lines.push(`| Evidence chain | ${m.integrity.ok ? "intact" : `BROKEN: ${m.integrity.violations.slice(0, 3).join(" | ")}`} |`);

  const k = m.kpis;
  lines.push("", "## Product quality KPIs (baseline — not optimised)", "", "| KPI | Value |", "| --- | --- |");
  lines.push(`| VALID_SIGNAL_RATE | ${pct(k.VALID_SIGNAL_RATE)} |`);
  lines.push(`| CROSS_SOURCE_CONFIRMATION_RATE | ${pct(k.CROSS_SOURCE_CONFIRMATION_RATE)} |`);
  lines.push(`| EVIDENCE_BACKED_OPPORTUNITY_RATE | ${pct(k.EVIDENCE_BACKED_OPPORTUNITY_RATE)} |`);
  lines.push(`| DEEP_DIVE_RATE | ${pct(k.DEEP_DIVE_RATE)} |`);
  lines.push(`| EXPERIMENT_CONVERSION_RATE | ${pct(k.EXPERIMENT_CONVERSION_RATE)} |`);
  lines.push(`| COST_PER_VALID_OPPORTUNITY | ${usd(k.COST_PER_VALID_OPPORTUNITY)} |`);
  lines.push(`| TIME_TO_VALID_OPPORTUNITY | ${k.TIME_TO_VALID_OPPORTUNITY_SECONDS === null ? "— (pending)" : `${k.TIME_TO_VALID_OPPORTUNITY_SECONDS} s`} |`);
  if (m.pendingHumanReview.length) lines.push("", `Pending human review: ${m.pendingHumanReview.join(", ")} (rate signals/opportunities in the app, then regenerate).`);

  lines.push("", "## Cost baseline", "", "| Item | USD |", "| --- | --- |");
  for (const [k2, v] of Object.entries(m.cost.byCategory)) lines.push(`| ${k2} | ${v.toFixed(6)} |`);
  for (const [k2, v] of Object.entries(m.cost.byProvider)) lines.push(`| provider: ${k2} | ${v.toFixed(6)} |`);
  lines.push(`| Total | ${m.cost.totalUsd.toFixed(6)} |`);
  lines.push(`| per SourceItem | ${usd(m.cost.perSourceItem)} |`, `| per Signal | ${usd(m.cost.perSignal)} |`, `| per Opportunity | ${usd(m.cost.perOpportunity)} |`, `| per Valid Opportunity | ${usd(m.cost.perValidOpportunity)} |`);
  lines.push("", "Infrastructure (Supabase, Vercel, worker host) is billed per plan and is not attributed per run.");

  lines.push("", "## Human quality review", "", "Human Rating / Human Decision are edited in the app (run page › Quality review) — the system never fills them.", "");
  lines.push("| Opportunity | Customer | Pain | Evidence | Source diversity | Pay signal | Score | Evidence confidence | Market size confidence | Main assumption | Red Team main objection | Next experiment | Human rating | Human decision |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of m.reviewTable) {
    lines.push(
      `| ${cell(row.opportunity)} | ${cell(row.customer)} | ${cell(row.pain)} | ${row.evidenceCount} | ${row.sourceDiversity} | ${cell(row.paySignal)} | ${row.opportunityScore ?? "—"} | ${row.evidenceConfidence} | ${row.marketSizeConfidence} | ${cell(row.mainAssumption)} | ${cell(row.redTeamMainObjection)} | ${cell(row.recommendedNextExperiment)} | ${row.humanRating ?? ""} | ${row.humanDecision === "NONE" ? "" : row.humanDecision} |`,
    );
  }
  if (r.fridayContext) {
    lines.push("", "## FRIDAY context", "", `- ${r.fridayContext.headline}`, `- Recommended next action: ${r.fridayContext.recommendedNextAction}`, ...r.fridayContext.unknowns.map((u) => `- Unknown: ${u}`));
  }
  return lines.join("\n") + "\n";
}
