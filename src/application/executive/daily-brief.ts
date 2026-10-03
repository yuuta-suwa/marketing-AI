import type { AppContext } from "@/application/context";
import type { StoredReport } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";
import { SIGNAL_TYPE_LABEL_JA } from "@/domain/signal/signal";

export type DailyBrief = {
  periodStart: string;
  periodEnd: string;
  newSignals: number;
  highSignalPains: Array<{ id: string; problem: string; type: string; urgency: number }>;
  fastRisingClusters: Array<{ id: string; name: string; momentum: number; signalCount: number }>;
  paySignals: Array<{ id: string; problem: string }>;
  switchingSignals: Array<{ id: string; problem: string }>;
  marketChanges: Array<{ id: string; problem: string; type: string }>;
  topOpportunities: Array<{ id: string; title: string; score: number | null; confidence: string }>;
  watchlistChanges: Array<{ id: string; title: string; body?: string }>;
  pendingDecisions: Array<{ id: string; title: string; status: string }>;
  meaningful: boolean;
};

/** Read-only computation of what changed in the period (default: last 24h). */
export async function computeDailyBrief(ctx: AppContext, sinceIso?: string): Promise<DailyBrief> {
  authorize(ctx.actor, "research.read");
  const end = ctx.clock.now();
  const start = sinceIso ? new Date(sinceIso) : new Date(end.getTime() - 86_400_000);
  const startIso = start.toISOString();
  const [signals, clusters, opportunities, notifications] = await Promise.all([
    ctx.repos.signals.listSignals({ limit: 1000 }),
    ctx.repos.signals.listClusters({ limit: 200 }),
    ctx.repos.opportunities.listOpportunities({ limit: 200 }),
    ctx.repos.executive.listNotifications({ limit: 50 }),
  ]);
  const fresh = signals.filter((s) => s.createdAt >= startIso);
  const brief: DailyBrief = {
    periodStart: startIso,
    periodEnd: end.toISOString(),
    newSignals: fresh.length,
    highSignalPains: fresh
      .filter((s) => s.urgencyScore >= 60)
      .sort((a, b) => b.urgencyScore - a.urgencyScore)
      .slice(0, 5)
      .map((s) => ({ id: s.id, problem: s.problem.slice(0, 120), type: SIGNAL_TYPE_LABEL_JA[s.signalType], urgency: s.urgencyScore })),
    fastRisingClusters: clusters
      .filter((c) => c.createdAt >= startIso && c.momentum > 20)
      .sort((a, b) => b.momentum - a.momentum)
      .slice(0, 5)
      .map((c) => ({ id: c.id, name: c.name, momentum: c.momentum, signalCount: c.signalCount })),
    paySignals: fresh.filter((s) => s.signalType === "PAY_SIGNAL" || s.willingnessToPayScore >= 60).slice(0, 5).map((s) => ({ id: s.id, problem: s.problem.slice(0, 120) })),
    switchingSignals: fresh.filter((s) => s.signalType === "SWITCHING").slice(0, 5).map((s) => ({ id: s.id, problem: s.problem.slice(0, 120) })),
    marketChanges: fresh
      .filter((s) => s.signalType === "REGULATION_GAP" || s.signalType === "PRICE_GAP")
      .slice(0, 5)
      .map((s) => ({ id: s.id, problem: s.problem.slice(0, 120), type: SIGNAL_TYPE_LABEL_JA[s.signalType] })),
    topOpportunities: opportunities.slice(0, 5).map((o) => ({ id: o.id, title: o.title, score: o.scoreTotal, confidence: o.confidence })),
    watchlistChanges: notifications.filter((n) => n.createdAt >= startIso && n.kind.startsWith("WATCH_")).map((n) => ({ id: n.id, title: n.title, body: n.body })),
    pendingDecisions: opportunities
      .filter((o) => o.status === "EXPERIMENT_PROPOSED" || o.status === "POC_PROPOSED")
      .map((o) => ({ id: o.id, title: o.title, status: o.status })),
    meaningful: false,
  };
  brief.meaningful =
    brief.highSignalPains.length > 0 ||
    brief.fastRisingClusters.length > 0 ||
    brief.paySignals.length > 0 ||
    brief.marketChanges.length > 0 ||
    brief.watchlistChanges.length > 0 ||
    brief.pendingDecisions.length > 0;
  return brief;
}

export function briefToMarkdown(b: DailyBrief): string {
  const list = (title: string, rows: string[]) => `## ${title}\n${rows.length ? rows.map((r) => `- ${r}`).join("\n") : "- なし"}\n`;
  return [
    `# Daily Market Brief (${b.periodEnd.slice(0, 10)})`,
    `新規シグナル ${b.newSignals}件`,
    list("New High-Signal Pains", b.highSignalPains.map((p) => `[${p.type}] ${p.problem}（緊急度 ${p.urgency}）`)),
    list("Fast Rising Clusters", b.fastRisingClusters.map((c) => `${c.name}（勢い ${c.momentum}・${c.signalCount}件）`)),
    list("Strong Pay Signals", b.paySignals.map((p) => p.problem)),
    list("Switching Signals", b.switchingSignals.map((p) => p.problem)),
    list("Price / Regulatory Changes", b.marketChanges.map((m) => `[${m.type}] ${m.problem}`)),
    list("Top Opportunities", b.topOpportunities.map((o) => `${o.title}（${o.score ?? "—"}点・証拠${o.confidence}）`)),
    list("Watchlist Changes", b.watchlistChanges.map((w) => `${w.title}${w.body ? ` — ${w.body}` : ""}`)),
    list("Pending CEO Decisions", b.pendingDecisions.map((p) => `${p.title}（${p.status}）`)),
  ].join("\n\n");
}

/**
 * Persists today's brief once per day and notifies only when something
 * meaningful changed. Returns null when there was nothing to report.
 */
export async function publishDailyBrief(ctx: AppContext): Promise<StoredReport | null> {
  const brief = await computeDailyBrief(ctx);
  const day = brief.periodEnd.slice(0, 10);
  if (!brief.meaningful) return null;
  const existing = (await ctx.repos.executive.listReports({ type: "DAILY_BRIEF", limit: 5 })).find((r) => r.periodEnd?.slice(0, 10) === day);
  if (existing) return existing;
  const report = await ctx.repos.executive.saveReport({
    reportType: "DAILY_BRIEF",
    title: `Daily Market Brief ${day}`,
    contentMd: briefToMarkdown(brief),
    contentJson: brief as unknown as Record<string, unknown>,
    periodStart: brief.periodStart,
    periodEnd: brief.periodEnd,
  });
  await ctx.repos.executive.createNotification({
    userId: ctx.actor.userId,
    kind: "DAILY_BRIEF",
    title: `今日の市場ブリーフ（新規シグナル ${brief.newSignals}件）`,
    body: brief.highSignalPains[0]?.problem,
    link: "/reports",
    severity: "INFO",
    dedupeKey: `brief:${day}`,
  });
  return report;
}
