import { describe, expect, it } from "vitest";
import { runGoldenResearch } from "@/application/golden/golden-run";
import { computeGoldenRunMetrics } from "@/application/golden/metrics";
import { renderGoldenRunReport } from "@/application/golden/report";
import { recordQualityReview } from "@/application/golden/review";
import { getWorkerHealthView } from "@/application/queries";
import { createDefaultConnectorRegistry } from "@/connectors/registry";
import { createMockFetch } from "@/connectors/mock";
import { MemoryDatabase } from "@/infrastructure/memory/memory-db";
import { testContext, testWorker } from "../helpers/context";

/**
 * HARNESS tests. Brave/e-Stat HTTP is stubbed at the fetch layer (canned
 * JSON), so items are NOT flagged synthetic — this proves the Golden Run
 * machinery and reporting, it is NOT live validation (that needs
 * `npm run golden-run` against real infrastructure).
 */
const creds: Record<string, string> = {
  BRAVE_SEARCH_API_KEY: "test-key",
  WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED: "true",
  ESTAT_APP_ID: "test-app-id",
};
const stubbedLive = () => createDefaultConnectorRegistry({ env: (n) => creds[n], fetch: createMockFetch() });

function harness(registry = stubbedLive(), db = new MemoryDatabase()) {
  const ctx = testContext({ db, connectors: registry, trusted: false });
  const { worker } = testWorker(ctx);
  return { ctx, worker, advanceQueue: async () => void (await worker.drain(100)) };
}

describe("golden research run harness", () => {
  it("drives every required stage through the queue and the worker, and reports it", async () => {
    const { ctx, advanceQueue } = harness();
    const result = await runGoldenResearch(ctx, { advanceQueue });
    expect(result.stages.filter((s) => !s.ok)).toEqual([]);
    expect(result.status).toBe("MVP_LIVE_VALIDATED");
    expect(result.stages.map((s) => s.stage)).toEqual(
      expect.arrayContaining([
        "ResearchDirective", "ResearchRun", "Queue", "Worker", "Brave / e-Stat", "No MOCK sources", "SourceItems", "Evidence", "Market Signals",
        "Signal Clusters", "Opportunities", "Opportunity Score", "Evidence Confidence", "Business Model", "CFO Analysis", "Red Team",
        "Evidence chain", "FRIDAY Context",
      ]),
    );
    const m = result.metrics!;
    expect(m.mockSources).toEqual([]);
    expect(m.connectorsUsed).toEqual(expect.arrayContaining(["web_search", "estat"]));
    expect(m.counts.opportunities).toBeGreaterThan(0);
    expect(m.evidenceQuality.opportunityEvidenceCoverage).toBe(1);
    expect(m.integrity.ok).toBe(true);
    expect(m.reviewTable.every((r) => r.humanRating === null && r.humanDecision === "NONE")).toBe(true); // never system-filled
    expect(m.pendingHumanReview).toEqual(expect.arrayContaining(["VALID_SIGNAL_RATE", "DEEP_DIVE_RATE", "COST_PER_VALID_OPPORTUNITY"]));

    const md = renderGoldenRunReport(result, { appEnv: "staging", version: "test", workerMode: "inline" });
    for (const section of ["## Pipeline stages", "## Evidence quality", "## Product quality KPIs", "## Cost baseline", "## Human quality review", "## FRIDAY context"]) {
      expect(md).toContain(section);
    }
    expect(md).toContain("VALID_SIGNAL_RATE | — (pending)");
  });

  it("refuses MOCK sources: a mock-backed run can never be reported as live-validated", async () => {
    const { ctx, advanceQueue } = harness(createDefaultConnectorRegistry({ env: () => undefined, mock: {} }));
    const result = await runGoldenResearch(ctx, { advanceQueue });
    expect(result.stages.find((s) => s.stage === "No MOCK sources")?.ok).toBe(false);
    expect(result.status).toBe("LIVE_VALIDATION_FAILED");
    expect(result.metrics?.evidenceQuality.mockSourceRate).toBe(1);
  });

  it("fails visibly when live sources are unavailable (no fabricated output)", async () => {
    const { ctx, advanceQueue } = harness(createDefaultConnectorRegistry({ env: (n) => creds[n], fetch: createMockFetch({ fail: ["web_search", "estat"] }) }));
    const result = await runGoldenResearch(ctx, { advanceQueue });
    expect(result.status).toBe("LIVE_VALIDATION_FAILED");
    expect(result.metrics?.counts.opportunities).toBe(0);
    expect(result.metrics?.errors.join()).toMatch(/web_search: \[UPSTREAM_5XX\]/);
  });

  it("KPIs come from human reviews only; unit economics from the cost ledger", async () => {
    const { ctx, advanceQueue } = harness();
    const result = await runGoldenResearch(ctx, { advanceQueue });
    const runId = result.runId!;
    const [o1, o2] = result.metrics!.reviewTable;
    const signals = await ctx.repos.signals.listSignals({ runId });
    await recordQualityReview(ctx, { researchRunId: runId, entityType: "OPPORTUNITY", entityId: o1.opportunityId, rating: 5, decision: "EXPERIMENT" });
    if (o2) await recordQualityReview(ctx, { researchRunId: runId, entityType: "OPPORTUNITY", entityId: o2.opportunityId, rating: 2, decision: "REJECT" });
    await recordQualityReview(ctx, { researchRunId: runId, entityType: "SIGNAL", entityId: signals[0].id, useful: true });
    await recordQualityReview(ctx, { researchRunId: runId, entityType: "SIGNAL", entityId: signals[1].id, useful: false });
    // Reviews are editable: the second save overwrites.
    await recordQualityReview(ctx, { researchRunId: runId, entityType: "SIGNAL", entityId: signals[1].id, useful: true });

    const m = await computeGoldenRunMetrics(ctx, runId);
    expect(m.kpis.VALID_SIGNAL_RATE).toBe(1);
    expect(m.kpis.DEEP_DIVE_RATE).toBeCloseTo(1 / m.counts.opportunities, 3);
    expect(m.kpis.EXPERIMENT_CONVERSION_RATE).toBe(1);
    expect(m.kpis.TIME_TO_VALID_OPPORTUNITY_SECONDS).not.toBeNull();
    expect(m.reviewTable.find((r) => r.opportunityId === o1.opportunityId)).toMatchObject({ humanRating: 5, humanDecision: "EXPERIMENT" });
    expect(m.pendingHumanReview).toEqual([]);
    expect(m.cost.totalUsd).toBeGreaterThan(0); // Brave stub requests are priced like live ones
    expect(m.cost.byCategory.SEARCH_API).toBeGreaterThan(0);
    expect(m.cost.perOpportunity).toBeCloseTo(m.cost.totalUsd / m.counts.opportunities, 6);
    expect(m.kpis.COST_PER_VALID_OPPORTUNITY).toBeCloseTo(m.cost.totalUsd, 6); // one valid opportunity
    expect(ctx.db.audit.filter((a) => a.action === "quality.reviewed").length).toBe(5);
  });

  it("workers publish health; only platform operators can read it", async () => {
    const { ctx, advanceQueue } = harness();
    await runGoldenResearch(ctx, { advanceQueue });
    const [snap] = [...ctx.db.workers.values()];
    expect(snap).toMatchObject({ workerId: "test-worker", busy: false });
    expect(snap.jobsProcessed).toBeGreaterThan(3);

    const owner = testContext({ db: ctx.db, actor: { ...ctx.actor, role: "owner" } });
    expect(await getWorkerHealthView(owner)).toBeNull(); // owners are not platform operators
    ctx.db.platformOperators.add(ctx.actor.userId);
    const view = await getWorkerHealthView(owner);
    expect(view?.status).toBe("HEALTHY");
    expect(JSON.stringify(view)).not.toContain("currentJobId");
    const member = testContext({ db: ctx.db, actor: { ...ctx.actor, role: "member" } });
    await expect(getWorkerHealthView(member)).rejects.toThrow(/Not allowed/);
  });
});
