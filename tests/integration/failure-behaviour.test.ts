import { describe, expect, it } from "vitest";
import { createResearch } from "@/application/research/create-research";
import { dispatchResearch } from "@/application/research/dispatch";
import { createDefaultConnectorRegistry } from "@/connectors/registry";
import { createMockFetch } from "@/connectors/mock";
import type { FetchLike } from "@/connectors/http";
import { MemoryJobStore } from "@/infrastructure/memory/memory-jobs";
import { FakeLLM } from "../helpers/fake-llm";
import { NOW, testContext, testWorker } from "../helpers/context";

/** Brave/e-Stat over a programmable fetch (stubbed HTTP; items are NOT synthetic). */
const creds: Record<string, string> = { BRAVE_SEARCH_API_KEY: "k", WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED: "true", ESTAT_APP_ID: "id" };
function registry(fetchImpl: FetchLike) {
  return createDefaultConnectorRegistry({ env: (n) => creds[n], fetch: fetchImpl });
}
const canned = createMockFetch();
const byHost = (overrides: Record<string, FetchLike>): FetchLike => async (input, init) => {
  const host = new URL(input).hostname;
  return (overrides[host] ?? canned)(input, init);
};

async function research(ctx: ReturnType<typeof testContext>) {
  const { run } = await createResearch(ctx, { input: "日本の旅行市場で不満を調べる", sourcePreferences: ["web_search", "estat"] });
  await dispatchResearch(ctx, run.id);
  await testWorker(ctx).worker.drain(100);
  return (await ctx.repos.research.getRun(run.id))!;
}

const counts = async (ctx: ReturnType<typeof testContext>, runId: string) => ({
  items: (await ctx.repos.evidence.listSourceItems(runId)).length,
  evidence: (await ctx.repos.evidence.listEvidence({ runId })).length,
  opportunities: (await ctx.repos.opportunities.listOpportunities({ runId })).length,
});

describe("failure behaviour (live connectors never fall back to mocks)", () => {
  it("Brave unavailable → e-Stat data kept, PARTIAL_SUCCESS with the reason, no synthetic items", async () => {
    const ctx = testContext({ connectors: registry(byHost({ "api.search.brave.com": async () => new Response("{}", { status: 503 }) })) });
    ctx.options = { ...ctx.options, connectorRetryBaseMs: 0 };
    const run = await research(ctx);
    expect(["PARTIAL_SUCCESS", "FAILED"]).toContain(run.status);
    expect(run.statusReason).toMatch(/web_search/);
    const items = await ctx.repos.evidence.listSourceItems(run.id);
    expect(items.every((i) => i.connectorId === "estat" && i.metadata?.synthetic !== true)).toBe(true);
    const [brave] = (await ctx.repos.ops.listConnectorRuns(run.id)).filter((c) => c.connectorKey === "web_search");
    expect(brave).toMatchObject({ status: "FAILED", retryCount: 1 });
  });

  it("e-Stat unavailable → Brave results analysed, PARTIAL_SUCCESS", async () => {
    const ctx = testContext({ connectors: registry(byHost({ "api.e-stat.go.jp": async () => new Response("{}", { status: 500 }) })) });
    ctx.options = { ...ctx.options, connectorRetryBaseMs: 0 };
    const run = await research(ctx);
    expect(run.status).toBe("PARTIAL_SUCCESS");
    expect(run.stats.connectorsFailed).toEqual(["estat"]);
    expect((await counts(ctx, run.id)).opportunities).toBeGreaterThan(0);
  });

  it("malformed provider response → INVALID_RESPONSE, not retried, others continue", async () => {
    let braveCalls = 0;
    const html: FetchLike = async () => {
      braveCalls++;
      return new Response("<html>maintenance</html>", { status: 200 });
    };
    const ctx = testContext({ connectors: registry(byHost({ "api.search.brave.com": html })) });
    const run = await research(ctx);
    const [brave] = (await ctx.repos.ops.listConnectorRuns(run.id)).filter((c) => c.connectorKey === "web_search");
    expect(brave.error).toMatch(/^\[INVALID_RESPONSE\]/);
    expect(braveCalls).toBe(1);
    expect(run.status).toMatch(/PARTIAL_SUCCESS|FAILED/);
  });

  it("quota exceeded (persistent 429) → RATE_LIMITED failure after bounded retries; never mock data", async () => {
    let calls = 0;
    const limited: FetchLike = async () => {
      calls++;
      return new Response("{}", { status: 429 });
    };
    const ctx = testContext({ connectors: registry(byHost({ "api.search.brave.com": limited, "api.e-stat.go.jp": limited })) });
    ctx.options = { ...ctx.options, connectorRetryBaseMs: 0 };
    const run = await research(ctx);
    expect(run.status).toBe("FAILED");
    expect(run.statusReason).toMatch(/データを取得できませんでした/);
    expect(calls).toBe(4); // 2 connectors × (1 + 1 retry)
    expect((await ctx.repos.ops.listConnectorRuns(run.id)).every((c) => c.status !== "FAILED" || c.error?.startsWith("[RATE_LIMITED]"))).toBe(true);
    expect(await ctx.repos.evidence.listSourceItems(run.id)).toEqual([]);
  });

  it("missing credentials → connectors skipped with the reason; the run fails, nothing is mocked", async () => {
    const ctx = testContext({ connectors: createDefaultConnectorRegistry({ env: () => undefined, fetch: canned }) });
    const run = await research(ctx);
    expect(run.status).toBe("FAILED");
    expect(await ctx.repos.evidence.listSourceItems(run.id)).toEqual([]);
    const skipped = (await ctx.repos.ops.listConnectorRuns(run.id)).filter((c) => c.status === "SKIPPED").map((c) => c.connectorKey);
    expect(skipped).toEqual(expect.arrayContaining(["web_search", "estat"]));
  });

  it("Anthropic unavailable → every agent falls back to deterministic logic; the run completes", async () => {
    const llm = new FakeLLM(() => {
      throw Object.assign(new Error("529 overloaded"), { status: 529 });
    });
    const ctx = testContext({ ai: llm, connectors: registry(canned) });
    const run = await research(ctx);
    expect(run.status).toMatch(/COMPLETED|PARTIAL_SUCCESS/);
    expect((await counts(ctx, run.id)).opportunities).toBeGreaterThan(0);
    const agents = await ctx.repos.ops.listAgentRuns({ runId: run.id });
    expect(agents.some((a) => a.provider === "fake" && a.status === "FAILED")).toBe(true);
    expect(agents.some((a) => a.provider === "heuristic" && a.status === "SUCCEEDED")).toBe(true);
  });

  it("temporary database error → the stage job retries; no duplicate evidence or opportunities", async () => {
    const clean = testContext({ connectors: registry(canned) });
    const baseline = await counts(clean, (await research(clean)).id);

    const ctx = testContext({ connectors: registry(canned) });
    let fail = true;
    const flaky = (c: typeof ctx) => {
      const insertEvidence = c.repos.evidence.insertEvidence.bind(c.repos.evidence);
      const evidenceRepo = {
        ...c.repos.evidence,
        insertEvidence: async (items: Parameters<typeof insertEvidence>[0]) => {
          const out = await insertEvidence(items); // the write lands…
          if (fail) {
            fail = false;
            throw new Error("canceling statement due to statement timeout"); // …but the response is lost
          }
          return out;
        },
      };
      return { ...c, repos: { ...c.repos, evidence: evidenceRepo } };
    };
    let t = NOW.getTime();
    const clock = { now: () => new Date(t) };
    const store = new MemoryJobStore(ctx.db, clock);
    const { run } = await createResearch(ctx, { input: "日本の旅行市場で不満を調べる", sourcePreferences: ["web_search", "estat"] });
    await dispatchResearch(ctx, run.id);
    const { worker } = testWorker(ctx, { store, mapContext: (c) => flaky(c as typeof ctx) });
    await worker.drain(100);
    expect((await ctx.repos.jobs.list({ researchRunId: run.id })).find((j) => j.jobType === "SIGNAL_EXTRACTION")).toMatchObject({ status: "RETRYING" });
    t += 60_000;
    await worker.drain(100);
    expect((await ctx.repos.research.getRun(run.id))?.status).toBe("COMPLETED");
    expect(await counts(ctx, run.id)).toEqual(baseline);
  });

  it("budget exceeded mid-run → completed work kept, optional LLM work skipped, explained", async () => {
    const llm = new FakeLLM(() => ({ signals: [] }), 0.4);
    const ctx = testContext({ ai: llm, connectors: registry(canned) });
    ctx.options = { ...ctx.options, limits: { ...ctx.options.limits, maxCostPerResearchRunUsd: 0.05 } };
    const run = await research(ctx);
    expect(run.status).toBe("PARTIAL_SUCCESS");
    expect(run.stats.budgetStops?.length).toBeGreaterThan(0);
    expect((await counts(ctx, run.id)).items).toBeGreaterThan(0);
  });
});
