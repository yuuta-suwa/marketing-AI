import { describe, expect, it } from "vitest";
import { estimateOpportunityMarket } from "@/application/analysis/market-size";
import { computeDailyBrief, publishDailyBrief } from "@/application/executive/daily-brief";
import { lineageCsv, recordFeedback } from "@/application/executive/feedback";
import { handleFridayCommand } from "@/application/executive/friday-command";
import { exportClaudeCodePrompt } from "@/application/executive/poc";
import { runScheduledMonitoring } from "@/application/executive/scheduled";
import { addWatch, checkWatchlists } from "@/application/executive/watchlist";
import { createResearch } from "@/application/research/create-research";
import { runResearchPipeline } from "@/application/research/pipeline";
import { createMemoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { TRAVEL_VOICES } from "../fixtures/travel-voices";
import { testContext } from "../helpers/context";

async function seeded(role: "owner" | "member" = "owner") {
  const ctx = testContext({ actor: { userId: "u-alice", organizationId: "org-a", role } });
  const { run } = await createResearch({ ...ctx, actor: { ...ctx.actor, role: "owner" } }, { input: "旅行市場の不満から新規事業を探す" });
  await runResearchPipeline({ ...ctx, actor: { ...ctx.actor, role: "owner" } }, run.id, { manualItems: TRAVEL_VOICES });
  const [opp] = await ctx.repos.opportunities.listOpportunities({ runId: run.id });
  return { ctx, opp };
}

const say = (ctx: Parameters<typeof handleFridayCommand>[0], text: string, opportunityId?: string) => handleFridayCommand(ctx, { text, opportunityId });

describe("FRIDAY executive flow", () => {
  it("drives an opportunity through the CEO approval gates and exports a Claude Code prompt", async () => {
    const { ctx, opp } = await seeded();
    expect((await say(ctx, "顧問会議", opp.id)).message).toContain("顧問会議");
    expect((await ctx.repos.executive.listAdvisorSessions(opp.id))[0].perspectives).toHaveLength(8);

    expect((await say(ctx, "承認 理由: 証拠は揃った", opp.id)).message).toContain("検証済");
    await say(ctx, "承認", opp.id); // → EXPERIMENT_PROPOSED
    await say(ctx, "承認", opp.id); // → EXPERIMENT_APPROVED (human)
    const spec = await say(ctx, "PoC仕様書", opp.id); // → POC_PROPOSED + spec
    expect(spec.message).toContain("DRAFT");
    expect((await ctx.repos.opportunities.getOpportunity(opp.id))?.status).toBe("POC_PROPOSED");
    expect((await say(ctx, "Claude Codeにエクスポート", opp.id)).message).toContain("PoC承認");

    // A member cannot give CEO approval
    const member = testContext({ db: ctx.db, actor: { ...ctx.actor, userId: "u-member", role: "member" } });
    expect((await say(member, "承認", opp.id)).message).toContain("実行できませんでした");
    expect((await ctx.repos.opportunities.getOpportunity(opp.id))?.status).toBe("POC_PROPOSED");

    await say(ctx, "承認 理由: CEO判断", opp.id); // → POC_APPROVED by owner
    expect((await ctx.repos.opportunities.getOpportunity(opp.id))?.status).toBe("POC_APPROVED");
    const exported = await exportClaudeCodePrompt(ctx, opp.id);
    expect(exported.contentMd).toContain("CLAUDE_CODE_BUILD_PROMPT");

    const decisions = await ctx.repos.opportunities.listDecisions(opp.id);
    expect(decisions.every((d) => d.source === "FRIDAY" && d.subject)).toBe(true);
    expect(decisions.find((d) => d.toStatus === "VALIDATED")?.rationale).toBe("証拠は揃った");
    expect(ctx.db.audit.filter((a) => a.action.startsWith("friday.")).length).toBeGreaterThan(3);
  });

  it("FRIDAY research command returns a run link and background work", async () => {
    const ctx = testContext();
    const r = await say(ctx, "訪日客の移動の不満から事業機会を探して");
    expect(r.intent).toBe("RESEARCH");
    expect(r.link?.href).toMatch(/^\/research\/runs\//);
    expect(typeof r.background).toBe("function");
    expect((await say(ctx, "Red Team")).message).toContain("Current Context");
  });
});

describe("watchlists, notifications and daily brief", () => {
  it("baseline first, then notifies a meaningful score change once (deduplicated)", async () => {
    const { ctx, opp } = await seeded();
    await addWatch(ctx, { targetType: "OPPORTUNITY", targetId: opp.id });
    await addWatch(ctx, { targetType: "OPPORTUNITY", targetId: opp.id }); // duplicate is ignored
    expect(await ctx.repos.executive.listWatchlists({ activeOnly: true })).toHaveLength(1);
    expect((await checkWatchlists(ctx)).notified).toBe(0);

    await estimateOpportunityMarket(ctx, {
      opportunityId: opp.id,
      method: "BOTTOM_UP",
      currency: "USD",
      inputs: {
        customers: { value: 50_000_000, unit: "people", epistemic: "ASSUMPTION" },
        purchasesPerYear: { value: 12, unit: "times/year", epistemic: "ASSUMPTION" },
        pricePerPurchase: { value: 20, unit: "currency", epistemic: "ASSUMPTION" },
      },
    });
    const after = await ctx.repos.opportunities.getOpportunity(opp.id);
    const r = await checkWatchlists(ctx);
    if (Math.abs((after?.scoreTotal ?? 0) - (opp.scoreTotal ?? 0)) >= 10) expect(r.notified).toBeGreaterThan(0);
    const again = await checkWatchlists(ctx);
    expect(again.notified).toBe(0);
  });

  it("keyword watch notifies a signal surge via the scheduled system job", async () => {
    const { ctx } = await seeded();
    await addWatch(ctx, { targetType: "KEYWORD", query: "い" });
    const dir = { listActiveWatchlists: async () => [...ctx.db.watchlists.values()], listBriefRecipients: async () => [] };
    const ctxFor = (org: string, user: string) => ({ ...ctx, actor: { userId: user, organizationId: org, role: "admin" as const }, repos: createMemoryRepositories(ctx.db, { userId: user, organizationId: org, role: "admin" }, ctx.clock, { system: true }) });
    // Baseline: watch created "now" → 0 signals in window; then backdate to include the seeded signals.
    expect((await runScheduledMonitoring(dir, ctxFor)).notified).toBe(0);
    for (const w of ctx.db.watchlists.values()) ctx.db.watchlists.set(w.id, { ...w, lastCheckedAt: "2000-01-01T00:00:00Z", snapshot: { matchingSignals: 0, checkedAt: "x" } });
    const r = await runScheduledMonitoring(dir, ctxFor);
    expect(r.errors).toEqual([]);
    expect(r.notified).toBeGreaterThan(0);
    expect((await ctx.repos.executive.listNotifications())[0].kind).toBe("WATCH_SIGNAL_SURGE");
  });

  it("daily brief is computed, published once per day, and skipped when nothing changed", async () => {
    const quiet = testContext();
    expect((await computeDailyBrief(quiet)).meaningful).toBe(false);
    expect(await publishDailyBrief(quiet)).toBeNull();

    const { ctx } = await seeded();
    const brief = await computeDailyBrief(ctx, "2000-01-01T00:00:00Z");
    expect(brief.newSignals).toBeGreaterThan(0);
    expect(brief.topOpportunities.length).toBeGreaterThan(0);
    const first = await publishDailyBrief(ctx);
    const second = await publishDailyBrief(ctx);
    expect(first?.id).toBe(second?.id);
    expect(first?.contentMd).toContain("Daily Market Brief");
  });
});

describe("feedback loop", () => {
  it("records outcomes and exports the Signal → Revenue lineage safely", async () => {
    const { ctx, opp } = await seeded();
    await recordFeedback(ctx, { opportunityId: opp.id, metric: "REVENUE", value: 120000, unit: "JPY" });
    await recordFeedback(ctx, { opportunityId: opp.id, metric: "CONVERSION", value: 0.06 });
    await recordFeedback(ctx, { opportunityId: opp.id, metric: "FEEDBACK", note: "=HYPERLINK(\"x\")" });
    await expect(recordFeedback(ctx, { opportunityId: opp.id, metric: "CHURN", value: 3 })).rejects.toThrow(/0〜1/);
    await expect(recordFeedback(ctx, { opportunityId: opp.id, metric: "FEEDBACK" })).rejects.toThrow(/数値かメモ/);
    const row = (await ctx.repos.executive.listLineage()).find((r) => r.opportunityId === opp.id);
    expect(row).toMatchObject({ revenueTotal: 120000, feedbackCount: 3 });
    expect(row!.signalCount).toBeGreaterThan(0);
    const csv = await lineageCsv(ctx);
    expect(csv.split("\n")[0]).toContain("revenueTotal");
    expect(csv).toContain("120000");
  });
});
