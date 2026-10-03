import { describe, expect, it } from "vitest";
import { LocalFridayAdapter } from "@/application/executive/local-friday";
import { startAdditionalResearch } from "@/application/opportunity/additional-research";
import { decideOpportunity } from "@/application/opportunity/decide";
import { runRedTeam } from "@/application/opportunity/red-team";
import { createResearch } from "@/application/research/create-research";
import { runResearchPipeline } from "@/application/research/pipeline";
import { ManualImportConnector } from "@/connectors/manual-import";
import { ConnectorError, type MarketConnector } from "@/domain/connector/connector";
import { RED_TEAM_QUESTIONS } from "@/domain/opportunity/red-team";
import { createMemoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { TRAVEL_VOICES } from "../fixtures/travel-voices";
import { FakeLLM } from "../helpers/fake-llm";
import { BOB, NOW, testContext } from "../helpers/context";

const REQUEST = { input: "旅行市場の不満から新規事業を探す" };

async function runSlice(ctx = testContext(), manualItems = TRAVEL_VOICES) {
  const { run } = await createResearch(ctx, REQUEST);
  const result = await runResearchPipeline(ctx, run.id, { manualItems });
  return { ctx, run, result };
}

function failingConnector(id = "flaky"): MarketConnector {
  return {
    id,
    name: "Flaky",
    category: "WEB",
    description: "always fails",
    env: [],
    sourceQuality: 0.5,
    enabledByDefault: true,
    credentialsRequired: false,
    search: async () => {
      throw new ConnectorError(id, "HTTP 503", true, 503);
    },
    healthCheck: async () => ({ status: "UNAVAILABLE", checkedAt: NOW.toISOString() }),
    complianceStatus: () => ({ status: "APPROVED", accessMethod: "OFFICIAL_API", notes: "", prohibitions: [] }),
    credentialsPresent: () => true,
  };
}

describe("first vertical slice (input → directive → sources → evidence → signals → clusters → opportunities)", () => {
  it("creates a queued run from mobile input", async () => {
    const ctx = testContext();
    const { run, parser } = await createResearch(ctx, REQUEST);
    expect(run.status).toBe("QUEUED");
    expect(parser).toBe("rule");
    const directive = await ctx.repos.research.getDirective(run.directiveId);
    expect(directive?.categories).toContain("travel");
  });

  it("runs the whole pipeline and produces ≥3 evidence-backed opportunities", async () => {
    const { ctx, run, result } = await runSlice();
    expect(result.status).toBe("COMPLETED");
    const stored = await ctx.repos.research.getRun(run.id);
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.startedAt).toBeTruthy();
    expect(stored?.completedAt).toBeTruthy();

    expect(result.stats.sourceItems).toBe(TRAVEL_VOICES.length - 1);
    expect(result.stats.duplicates).toBe(1);

    const items = await ctx.repos.evidence.listSourceItems(run.id);
    for (const item of items) {
      expect(item.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(item.complianceStatus).toBe("MANUAL_UPLOAD");
    }

    const evidence = await ctx.repos.evidence.listEvidence({ runId: run.id });
    const bodies = new Map(items.map((i) => [i.id, i.body]));
    for (const e of evidence) expect(bodies.get(e.sourceItemId)).toContain(e.evidenceText);
    expect(evidence.some((e) => e.evidenceText.includes("景色がきれい"))).toBe(false);

    const signals = await ctx.repos.signals.listSignals({ runId: run.id });
    const evidenceIds = new Set(evidence.map((e) => e.id));
    expect(signals.length).toBeGreaterThanOrEqual(6);
    for (const s of signals) for (const id of s.evidenceIds) expect(evidenceIds.has(id)).toBe(true);

    const clusters = await ctx.repos.signals.listClusters({ runId: run.id });
    expect(clusters.length).toBeGreaterThanOrEqual(3);

    const opportunities = await ctx.repos.opportunities.listOpportunities({ runId: run.id });
    expect(opportunities.length).toBeGreaterThanOrEqual(3);
    for (const o of opportunities) {
      expect(o.status).toBe("DISCOVERED");
      expect(o.scoreTotal).toBeGreaterThan(0);
      expect(["LOW", "MEDIUM", "HIGH"]).toContain(o.confidence);
      expect(o.marketSizeSummary).toContain("未推定");
      expect(o.fieldProvenance.revenueModel).toBe("HYPOTHESIS");
      const linked = await ctx.repos.opportunities.listOpportunityEvidenceIds(o.id);
      expect(linked.length).toBeGreaterThan(0);
      for (const id of linked) expect(evidenceIds.has(id)).toBe(true);
      const score = await ctx.repos.opportunities.latestScore(o.id);
      expect(score?.score.total).toBe(o.scoreTotal);
      expect(score?.confidenceBreakdown.level).toBe(o.confidence);
    }

    const connectorRuns = await ctx.repos.ops.listConnectorRuns(run.id);
    expect(connectorRuns.find((c) => c.connectorKey === "manual_import")?.status).toBe("SUCCESS");
    expect(connectorRuns.find((c) => c.connectorKey === "web_search")?.status).toBe("SKIPPED");
    const agentRuns = await ctx.repos.ops.listAgentRuns({ runId: run.id });
    expect(agentRuns.every((a) => a.status === "SUCCEEDED")).toBe(true);
    const actions = new Set(ctx.db.audit.map((a) => a.action));
    for (const a of ["research.created", "research.started", "connector.executed", "agent.executed", "research.completed"]) {
      expect(actions.has(a)).toBe(true);
    }
  });

  it("runs Red Team, records a human decision, consults FRIDAY and starts additional research", async () => {
    const { ctx, run } = await runSlice();
    const [top] = await ctx.repos.opportunities.listOpportunities({ runId: run.id });

    const review = await runRedTeam(ctx, top.id);
    expect(review.findings).toHaveLength(RED_TEAM_QUESTIONS.length);
    expect(["PROCEED", "PROCEED_WITH_CAUTION", "NEEDS_EVIDENCE", "STOP"]).toContain(review.verdict);

    const friday = new LocalFridayAdapter(ctx);
    const briefing = await friday.consult(top.id);
    expect(briefing.redTeamVerdict).toBe(review.verdict);
    expect(briefing.evidenceCount).toBeGreaterThan(0);
    expect(briefing.unknowns.length).toBeGreaterThan(0);

    const { opportunity } = await decideOpportunity(ctx, { opportunityId: top.id, decision: "HOLD", rationale: "証拠不足" });
    expect(opportunity.status).toBe("ON_HOLD");
    const decisions = await ctx.repos.opportunities.listDecisions(top.id);
    expect(decisions[0]).toMatchObject({ decision: "HOLD", decidedBy: "u-alice", fromStatus: "DISCOVERED", toStatus: "ON_HOLD" });

    const extra = await startAdditionalResearch(ctx, {
      opportunityId: top.id,
      type: "WILLINGNESS_TO_PAY",
      manualItems: [{ body: "荷物を預ける場所が足りない。1回500円なら払ってもいい。" }],
    });
    const extraRun = await ctx.repos.research.getRun(extra.runId);
    expect(extraRun).toMatchObject({ runType: "WILLINGNESS_TO_PAY", opportunityId: top.id, parentRunId: run.id });
    expect((await ctx.repos.research.listRuns({ opportunityId: top.id })).map((r) => r.id)).toContain(extra.runId);

    expect(ctx.db.audit.some((a) => a.action === "friday.consult")).toBe(true);
    expect(ctx.db.audit.some((a) => a.action === "opportunity.decided")).toBe(true);
  });

  it("enforces decision gates in the application layer", async () => {
    const { ctx, run } = await runSlice();
    const [top] = await ctx.repos.opportunities.listOpportunities({ runId: run.id });
    await expect(decideOpportunity(ctx, { opportunityId: top.id, decision: "APPROVE", toStatus: "POC_APPROVED" })).rejects.toThrow(/Illegal/);
    await expect(ctx.repos.opportunities.setStatus(top.id, "REJECTED")).rejects.toThrow(/human/);
    const viewer = testContext({ db: ctx.db, actor: { ...ctx.actor, userId: "u-viewer", role: "viewer" } });
    await expect(decideOpportunity(viewer, { opportunityId: top.id, decision: "REJECT" })).rejects.toThrow(/Not allowed/);
  });
});

describe("resilience, budget and integrity", () => {
  it("a failing connector degrades the run to PARTIAL_SUCCESS instead of failing it", async () => {
    const ctx = testContext({ connectors: [new ManualImportConnector(), failingConnector()] });
    const { result, run } = await runSlice(ctx);
    expect(result.status).toBe("PARTIAL_SUCCESS");
    expect(result.stats.connectorsFailed).toEqual(["flaky"]);
    expect(result.reason).toContain("flaky");
    const cr = (await ctx.repos.ops.listConnectorRuns(run.id)).find((c) => c.connectorKey === "flaky");
    expect(cr).toMatchObject({ status: "FAILED", retryCount: 1 });
    expect((await ctx.repos.opportunities.listOpportunities({ runId: run.id })).length).toBeGreaterThanOrEqual(3);
  });

  it("fails loudly (not silently) when no connector produced data", async () => {
    const ctx = testContext({ connectors: [failingConnector()] });
    const { result } = await runSlice(ctx, []);
    expect(result.status).toBe("FAILED");
    expect(result.reason).toContain("flaky");
  });

  it("LLM signals citing invented evidence ids are rejected", async () => {
    const llm = new FakeLLM((agent, prompt) => {
      if (agent === "PainMinerAgent") {
        const ids = [...prompt.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
        const base = { urgencyScore: 60, frequencySignal: 40, willingnessToPayScore: 20, switchingIntentScore: 10, trustIssue: false, priceIssue: false, accessIssue: true, signalType: "ACCESS_GAP", confidence: "LOW" };
        return {
          signals: [
            { ...base, problem: "空港アクセスが分かりにくい", evidenceIds: [ids[0]] },
            { ...base, problem: "ロッカー不足", evidenceIds: [ids[3] ?? ids[0]] },
            { ...base, problem: "捏造", evidenceIds: ["00000000-dead-beef-0000-000000000000"] },
          ],
        };
      }
      throw new Error("not scripted");
    });
    const ctx = testContext({ ai: llm });
    const { run, result } = await runSlice(ctx);
    expect(result.status).toBe("PARTIAL_SUCCESS");
    const signals = await ctx.repos.signals.listSignals({ runId: run.id });
    expect(signals.map((s) => s.problem)).not.toContain("捏造");
    expect(signals.every((s) => s.extractedBy === "fake:fake-1")).toBe(true);
    // JTBD agent "fails" (unscripted) → falls back to deterministic drafting; opportunities still exist.
    expect((await ctx.repos.opportunities.listOpportunities({ runId: run.id })).length).toBeGreaterThan(0);
    expect((await ctx.repos.ops.listAgentRuns({ runId: run.id })).some((a) => a.status === "FAILED")).toBe(true);
  });

  it("stops paid agents when the budget is exhausted, keeps data and explains why", async () => {
    const llm = new FakeLLM(() => ({ signals: [] }), 5);
    const ctx = testContext({ ai: llm });
    const { run, result } = await runSlice(ctx);
    expect(llm.calls).toHaveLength(0);
    expect(result.status).toBe("PARTIAL_SUCCESS");
    expect(result.stats.budgetStops?.[0]).toContain("予算上限");
    expect((await ctx.repos.ops.listAgentRuns({ runId: run.id })).some((a) => a.status === "SKIPPED_BUDGET")).toBe(true);
    expect((await ctx.repos.opportunities.listOpportunities({ runId: run.id })).length).toBeGreaterThanOrEqual(3);
  });

  it("records LLM cost in the ledger", async () => {
    const llm = new FakeLLM(() => ({ signals: [] }), 0.01);
    const ctx = testContext({ ai: llm });
    const { run } = await runSlice(ctx);
    expect(await ctx.repos.ops.spendByRun(run.id)).toBeGreaterThan(0);
  });

  it("organizations cannot see each other's data", async () => {
    const { ctx, run } = await runSlice();
    const bob = createMemoryRepositories(ctx.db, BOB, ctx.clock);
    expect(await bob.research.getRun(run.id)).toBeNull();
    expect(await bob.opportunities.listOpportunities()).toHaveLength(0);
    expect(await bob.evidence.listEvidence({ runId: run.id })).toHaveLength(0);
    const [opp] = await ctx.repos.opportunities.listOpportunities();
    await expect(bob.opportunities.setStatus(opp.id, "RESEARCHING")).rejects.toThrow(/not found/);
  });

  it("viewers cannot start research", async () => {
    const ctx = testContext({ actor: { userId: "v", organizationId: "org-a", role: "viewer" } });
    await expect(createResearch(ctx, REQUEST)).rejects.toThrow(/Not allowed/);
  });
});
