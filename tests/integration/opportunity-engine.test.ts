import { describe, expect, it } from "vitest";
import { compareOpportunityBusinessModels, runCfoAnalysis } from "@/application/analysis/business-model";
import { addManualCompetitor, analyzeCompetitors } from "@/application/analysis/competitors";
import { advanceExperiment, createExperiment } from "@/application/analysis/experiments";
import { estimateOpportunityMarket } from "@/application/analysis/market-size";
import { startAdditionalResearch } from "@/application/opportunity/additional-research";
import { createResearch } from "@/application/research/create-research";
import { runResearchPipeline } from "@/application/research/pipeline";
import { updateScoringWeights } from "@/application/settings/scoring";
import { DEFAULT_SCORING_WEIGHTS } from "@/domain/scoring/criteria";
import { TRAVEL_VOICES } from "../fixtures/travel-voices";
import { testContext } from "../helpers/context";

async function seeded() {
  const ctx = testContext();
  const { run } = await createResearch(ctx, { input: "旅行市場の不満から新規事業を探す" });
  await runResearchPipeline(ctx, run.id, { manualItems: TRAVEL_VOICES });
  const opps = await ctx.repos.opportunities.listOpportunities({ runId: run.id });
  return { ctx, run, opps };
}

describe("opportunity engine", () => {
  it("competitors, business models, CFO and market size update the opportunity and its score", async () => {
    const { ctx, opps } = await seeded();
    const opp = opps.find((o) => o.title.includes("ロッカー") || o.pain.includes("ロッカー")) ?? opps[0];
    const before = await ctx.repos.opportunities.latestScore(opp.id);
    expect(before?.score.missing).toContain("marketSize");

    const competitors = await analyzeCompetitors(ctx, opp.id);
    expect(competitors.every((c) => c.sourceEvidenceIds.length > 0)).toBe(true);
    const evidenceIds = await ctx.repos.opportunities.listOpportunityEvidenceIds(opp.id);
    await addManualCompetitor(ctx, opp.id, { name: "既存の荷物預かりサービス", competitorType: "DIRECT", evidenceId: evidenceIds[0] });
    await expect(addManualCompetitor(ctx, opp.id, { name: "x", competitorType: "DIRECT", evidenceId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/Evidence/);
    expect((await ctx.repos.analysis.listCompetitors(opp.id)).some((c) => c.epistemicStatus === "FACT")).toBe(true);

    const models = await compareOpportunityBusinessModels(ctx, opp.id);
    expect(models).toHaveLength(11);
    expect(models.filter((m) => m.isPrimary)).toHaveLength(1);
    expect((await ctx.repos.opportunities.getOpportunity(opp.id))?.fieldProvenance.revenueModel).toBe("HYPOTHESIS");

    const { analysis } = await runCfoAnalysis(ctx, { opportunityId: opp.id, inputs: { pricePerMonth: 1500 } });
    expect(analysis.metrics.sellingPrice.value).toBe(1500);
    expect(analysis.metrics.grossMargin.epistemic).toBe("CALCULATION");

    await estimateOpportunityMarket(ctx, {
      opportunityId: opp.id,
      method: "BOTTOM_UP",
      currency: "JPY",
      inputs: {
        customers: { value: 2_000_000, unit: "people", epistemic: "ASSUMPTION" },
        purchasesPerYear: { value: 2, unit: "times/year", epistemic: "ASSUMPTION" },
        pricePerPurchase: { value: 500, unit: "currency", epistemic: "ASSUMPTION" },
      },
    });
    const updated = await ctx.repos.opportunities.getOpportunity(opp.id);
    expect(updated?.marketSizeSummary).toContain("2,000,000,000");
    expect(updated?.fieldProvenance.marketSizeSummary).toBe("CALCULATION");
    const after = await ctx.repos.opportunities.latestScore(opp.id);
    expect(after?.score.missing).not.toContain("marketSize");
    expect(after?.score.missing).not.toContain("monetizationQuality");
    expect(after?.score.components.marketSize.epistemic).toBe("CALCULATION");
  });

  it("additional research links related new evidence to the opportunity and re-scores it", async () => {
    const { ctx, opps } = await seeded();
    const opp = opps[0];
    const evidenceBefore = (await ctx.repos.opportunities.listOpportunityEvidenceIds(opp.id)).length;
    const scoresBefore = await ctx.repos.opportunities.latestScore(opp.id);
    const extra = await startAdditionalResearch(ctx, {
      opportunityId: opp.id,
      type: "WILLINGNESS_TO_PAY",
      manualItems: [
        { body: `${opp.pain} 有料でもいいので解決してほしい。`, sourceName: "追加インタビュー" },
        { body: "まったく関係のない話題です。天気が良い。", sourceName: "追加インタビュー" },
      ],
    });
    expect(extra.stats.opportunities).toBe(0);
    expect(extra.stats.linkedToOpportunity).toBeGreaterThan(0);
    const evidenceAfter = await ctx.repos.opportunities.listOpportunityEvidenceIds(opp.id);
    expect(evidenceAfter.length).toBeGreaterThan(evidenceBefore);
    const latest = await ctx.repos.opportunities.latestScore(opp.id);
    expect(latest?.id).not.toBe(scoresBefore?.id);
    expect(latest?.scoredBy).toContain("WILLINGNESS_TO_PAY");
    expect(ctx.db.audit.some((a) => a.action === "opportunity.updated_from_research")).toBe(true);
  });

  it("experiments: create → human approve → run → complete with result and decision", async () => {
    const { ctx, opps } = await seeded();
    const exp = await createExperiment(ctx, opps[0].id, {
      title: "LP検証",
      hypothesis: "荷物預かりに月額課金する",
      method: "LP + 広告",
      metric: "事前登録率",
      target: "5%",
      budgetUsd: 300,
      deadline: "2026-11-30",
    });
    expect(exp.status).toBe("PROPOSED");
    await expect(advanceExperiment(ctx, exp.id, { type: "start" })).rejects.toThrow(/Illegal/);
    const approved = await advanceExperiment(ctx, exp.id, { type: "approve" });
    expect(approved.approvedBy).toBe(ctx.actor.userId);
    await advanceExperiment(ctx, exp.id, { type: "start" });
    const done = await advanceExperiment(ctx, exp.id, { type: "complete", resultSummary: "登録率 6.2%", decision: "CONTINUE" });
    expect(done).toMatchObject({ status: "COMPLETED", decision: "CONTINUE", decidedBy: ctx.actor.userId });
    const viewer = testContext({ db: ctx.db, actor: { ...ctx.actor, role: "viewer" } });
    await expect(createExperiment(viewer, opps[0].id, { title: "x", hypothesis: "x", method: "x", metric: "x", target: "x", budgetUsd: 0, deadline: "2026-12-01" })).rejects.toThrow(/Not allowed/);
  });

  it("scoring weights are admin-only and must total 100; new weights apply to later scores", async () => {
    const { ctx, opps } = await seeded();
    const member = testContext({ db: ctx.db, actor: { ...ctx.actor, role: "member" } });
    await expect(updateScoringWeights(member, DEFAULT_SCORING_WEIGHTS)).rejects.toThrow(/Not allowed/);
    await expect(updateScoringWeights(ctx, { ...DEFAULT_SCORING_WEIGHTS, painSeverity: 99 })).rejects.toThrow(/合計/);
    const w = { ...DEFAULT_SCORING_WEIGHTS, painSeverity: 25, frequency: 0 };
    await updateScoringWeights(ctx, w);
    await compareOpportunityBusinessModels(ctx, opps[0].id);
    await runCfoAnalysis(ctx, { opportunityId: opps[0].id });
    expect((await ctx.repos.opportunities.latestScore(opps[0].id))?.weights.painSeverity).toBe(25);
  });
});
