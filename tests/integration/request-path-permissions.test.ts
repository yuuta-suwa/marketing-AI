import { describe, expect, it } from "vitest";
import { compareOpportunityBusinessModels, runCfoAnalysis } from "@/application/analysis/business-model";
import { analyzeCompetitors } from "@/application/analysis/competitors";
import { createExperiment } from "@/application/analysis/experiments";
import { estimateOpportunityMarket } from "@/application/analysis/market-size";
import { LocalFridayAdapter } from "@/application/executive/local-friday";
import { startAdditionalResearch } from "@/application/opportunity/additional-research";
import { decideOpportunity } from "@/application/opportunity/decide";
import { runRedTeam } from "@/application/opportunity/red-team";
import { requestResearchCancellation } from "@/application/research/cancel";
import { createResearch } from "@/application/research/create-research";
import { dispatchResearch } from "@/application/research/dispatch";
import { ManualImportConnector } from "@/connectors/manual-import";
import { MemoryDatabase } from "@/infrastructure/memory/memory-db";
import { TRAVEL_VOICES } from "../fixtures/travel-voices";
import { testContext, testWorker } from "../helpers/context";

/**
 * Phase 6 authorization model, exercised through the request-path use cases
 * with member (untrusted) repositories that mirror the DB grants: members
 * create/queue/cancel/decide/analyse, but every worker-controlled write is
 * performed by the worker only.
 */
function member(db = new MemoryDatabase()) {
  return testContext({ db, trusted: false, connectors: [new ManualImportConnector()] });
}

describe("request path never writes worker-controlled data", () => {
  it("full journey as a member: create → queue → (worker) → analyses → decisions → additional research", async () => {
    const ctx = member();
    const { run } = await createResearch(ctx, { input: "旅行市場の不満から新規事業を探す" });
    expect(run.status).toBe("QUEUED"); // created directly as QUEUED, no user UPDATE
    await dispatchResearch(ctx, run.id, { manualItems: TRAVEL_VOICES });
    await testWorker(ctx).worker.drain();
    expect((await ctx.repos.research.getRun(run.id))?.status).toBe("COMPLETED");

    const [opp] = await ctx.repos.opportunities.listOpportunities({ runId: run.id });
    const scoreBefore = await ctx.repos.opportunities.latestScore(opp.id);
    await analyzeCompetitors(ctx, opp.id);
    await compareOpportunityBusinessModels(ctx, opp.id);
    await runCfoAnalysis(ctx, { opportunityId: opp.id });
    await estimateOpportunityMarket(ctx, {
      opportunityId: opp.id,
      method: "BOTTOM_UP",
      currency: "JPY",
      inputs: {
        customers: { value: 1_000_000, unit: "people", epistemic: "ASSUMPTION" },
        purchasesPerYear: { value: 2, unit: "times/year", epistemic: "ASSUMPTION" },
        pricePerPurchase: { value: 500, unit: "currency", epistemic: "ASSUMPTION" },
      },
    });
    await runRedTeam(ctx, opp.id);
    // Scores were not touched by the request path; the worker re-scores.
    expect((await ctx.repos.opportunities.latestScore(opp.id))?.id).toBe(scoreBefore?.id);
    expect((await ctx.repos.jobs.list({ status: "QUEUED" })).filter((j) => j.jobType === "OPPORTUNITY_REASSESSMENT").length).toBeGreaterThan(0);
    await testWorker(ctx).worker.drain();
    expect((await ctx.repos.opportunities.latestScore(opp.id))?.id).not.toBe(scoreBefore?.id);

    await decideOpportunity(ctx, { opportunityId: opp.id, decision: "HOLD", rationale: "証拠を集める" });
    await createExperiment(ctx, opp.id, { title: "LP", hypothesis: "h", method: "m", metric: "x", target: "y", budgetUsd: 10, deadline: "2026-12-01" });
    expect((await new LocalFridayAdapter(ctx).consult(opp.id)).headline).toBe(opp.title);

    const extra = await startAdditionalResearch(ctx, { opportunityId: opp.id, type: "WILLINGNESS_TO_PAY", manualItems: [{ body: "荷物を預ける場所が足りない。有料でもいい。" }] });
    await testWorker(ctx).worker.drain();
    expect((await ctx.repos.research.getRun(extra.runId))?.status).toMatch(/COMPLETED|PARTIAL_SUCCESS/);
  });

  it("members cannot write run state, pipeline output or system scores directly", async () => {
    const ctx = member();
    const { run } = await createResearch(ctx, { input: "旅行市場の不満" });
    const forbidden = /worker-only/;
    await expect(ctx.repos.research.transitionRun(run.id, "COMPLETED")).rejects.toThrow(forbidden);
    await expect(ctx.repos.research.transitionRun(run.id, "QUEUED", { costUsd: 0, progressPercent: 100 })).rejects.toThrow(forbidden);
    await expect(ctx.repos.evidence.insertSourceItems([])).rejects.toThrow(forbidden);
    await expect(ctx.repos.evidence.insertEvidence([])).rejects.toThrow(forbidden);
    await expect(ctx.repos.signals.insertSignals([])).rejects.toThrow(forbidden);
    await expect(ctx.repos.signals.insertClusters([])).rejects.toThrow(forbidden);
    await expect(ctx.repos.signals.setEmbeddings([])).rejects.toThrow(forbidden);
    await expect(ctx.repos.ops.recordConnectorRun({ researchRunId: run.id, connectorKey: "x", status: "SUCCESS", resultCount: 0, duplicateCount: 0, durationMs: 0, retryCount: 0, startedAt: "", completedAt: "" })).rejects.toThrow(forbidden);
    await expect(ctx.repos.opportunities.updateAssessment("any", { scoreTotal: 99 })).rejects.toThrow(forbidden);
    await expect(ctx.repos.opportunities.linkEvidence("any", [])).rejects.toThrow(forbidden);
  });

  it("members cancel through the approved interface (queued → CANCELLED, processing → CANCELLING)", async () => {
    const db = new MemoryDatabase();
    const ctx = member(db);
    const a = await createResearch(ctx, { input: "旅行の不満A" });
    await dispatchResearch(ctx, a.run.id, { manualItems: TRAVEL_VOICES });
    expect(await requestResearchCancellation(ctx, a.run.id)).toBe("CANCELLED");
    expect((await ctx.repos.research.getRun(a.run.id))?.status).toBe("CANCELLED");
    expect((await ctx.repos.jobs.list({ researchRunId: a.run.id }))[0].status).toBe("CANCELLED");
    expect(ctx.db.audit.some((x) => x.action === "research.cancel_requested" && x.entityId === a.run.id)).toBe(true);

    const b = await createResearch(ctx, { input: "旅行の不満B" });
    await dispatchResearch(ctx, b.run.id, { manualItems: TRAVEL_VOICES });
    const { store } = testWorker(ctx);
    await store.claim("worker-1", { limit: 1, leaseSeconds: 60 });
    expect(await requestResearchCancellation(ctx, b.run.id)).toBe("CANCELLING");
    expect(await store.heartbeat((await ctx.repos.jobs.list({ researchRunId: b.run.id }))[0].id, "worker-1", 60)).toBe(false);

    const viewer = testContext({ db, trusted: false, actor: { ...ctx.actor, userId: "u-viewer", role: "viewer" } });
    await expect(requestResearchCancellation(viewer, b.run.id)).rejects.toThrow();
  });
});
