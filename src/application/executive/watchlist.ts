import type { AppContext } from "@/application/context";
import type { StoredWatchlist, WatchTarget } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";
import { detectChanges, type WatchSnapshot } from "@/domain/executive/change-detection";
import { DomainError } from "@/domain/shared/errors";

const LABEL: Record<WatchTarget, string> = {
  OPPORTUNITY: "機会", COMPETITOR: "競合", PROBLEM: "課題", MARKET: "市場", COUNTRY: "国", KEYWORD: "キーワード",
  INDUSTRY: "業界", PERSONA: "ペルソナ", TECHNOLOGY: "技術", REGULATION: "規制",
};

export async function addWatch(
  ctx: AppContext,
  input: { targetType: WatchTarget; targetId?: string; query?: string; label?: string },
): Promise<StoredWatchlist> {
  authorize(ctx.actor, "watchlist.manage");
  if (input.targetType !== "OPPORTUNITY" && !input.query?.trim()) throw new DomainError("VALIDATION", "監視キーワードを入力してください");
  const w = await ctx.repos.executive.createWatchlist({
    targetType: input.targetType,
    targetId: input.targetType === "OPPORTUNITY" ? input.targetId : undefined,
    query: input.targetType === "OPPORTUNITY" ? undefined : input.query?.trim().slice(0, 200),
    label: input.label?.slice(0, 200) ?? `${LABEL[input.targetType]}: ${input.query ?? ""}`.slice(0, 200),
    scheduleCron: "0 * * * *",
  });
  await ctx.repos.ops.audit("watchlist.created", "watchlist", w.id, { targetType: w.targetType });
  return w;
}

/** Current state of what a watchlist observes. */
async function snapshotFor(ctx: AppContext, w: StoredWatchlist, nowIso: string): Promise<WatchSnapshot | null> {
  if (w.targetType === "OPPORTUNITY") {
    const opp = w.targetId ? await ctx.repos.opportunities.getOpportunity(w.targetId) : null;
    // Defense in depth for system (service-role) runs: never read across tenants.
    if (!opp || opp.organizationId !== w.organizationId) return null;
    const competitors = await ctx.repos.analysis.listCompetitors(opp.id);
    return { score: opp.scoreTotal, confidence: opp.confidence, competitorNames: competitors.map((c) => c.name), checkedAt: nowIso };
  }
  const since = w.lastCheckedAt ?? w.createdAt;
  const query = w.targetType === "COUNTRY" ? undefined : w.query;
  const country = w.targetType === "COUNTRY" ? w.query?.toUpperCase() : undefined;
  const counts = await ctx.repos.signals.countSignalsSince({ since, query, country });
  const snapshot: WatchSnapshot = {
    matchingSignals: counts.total,
    regulationSignals: counts.byType.REGULATION_GAP ?? 0,
    priceSignals: counts.byType.PRICE_GAP ?? 0,
    checkedAt: nowIso,
  };
  if (w.targetType === "COMPETITOR") {
    const opps = await ctx.repos.opportunities.listOpportunities({ limit: 100 });
    const names = (await Promise.all(opps.map((o) => ctx.repos.analysis.listCompetitors(o.id)))).flat().map((c) => c.name);
    snapshot.competitorNames = [...new Set(names.filter((n) => n.toLowerCase().includes((w.query ?? "").toLowerCase())))];
  }
  return snapshot;
}

/**
 * Checks the actor's watchlists (or, in system runs, the given ones) and
 * notifies only meaningful changes, deduplicated per watchlist/day/kind.
 */
export async function checkWatchlists(ctx: AppContext, options: { watchlists?: StoredWatchlist[] } = {}): Promise<{ checked: number; notified: number }> {
  const nowIso = ctx.clock.now().toISOString();
  const lists = options.watchlists ?? (await ctx.repos.executive.listWatchlists({ activeOnly: true, mineOnly: true }));
  let notified = 0;
  for (const w of lists) {
    const snapshot = await snapshotFor(ctx, w, nowIso);
    if (!snapshot) continue;
    const events = detectChanges(w.label ?? LABEL[w.targetType], w.snapshot, snapshot);
    for (const e of events) {
      const created = await ctx.repos.executive.createNotification({
        userId: w.userId,
        kind: `WATCH_${e.kind}`,
        title: e.title,
        body: e.body,
        link: w.targetType === "OPPORTUNITY" && w.targetId ? `/opportunities/${w.targetId}` : "/watchlists",
        severity: e.severity,
        watchlistId: w.id,
        dedupeKey: `watch:${w.id}:${e.kind}:${nowIso.slice(0, 10)}`,
      });
      if (created) notified++;
    }
    // The stored snapshot becomes the baseline for the next window.
    await ctx.repos.executive.updateWatchlist(w.id, { snapshot, lastCheckedAt: nowIso });
  }
  return { checked: lists.length, notified };
}
