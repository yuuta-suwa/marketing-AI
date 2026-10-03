import { describe, expect, it } from "vitest";
import { createResearch } from "@/application/research/create-research";
import { runResearchPipeline } from "@/application/research/pipeline";
import { updateConnectorSetting } from "@/application/settings/connectors";
import { createDefaultConnectorRegistry } from "@/connectors/registry";
import { ManualImportConnector } from "@/connectors/manual-import";
import { testContext } from "../helpers/context";

const mockRegistry = (fail: string[] = []) => createDefaultConnectorRegistry({ env: () => undefined, mock: { fail } });

describe("research engine with mock connectors", () => {
  it("「日本の旅行市場で不満を調べる」 → run → sources → evidence → signals (no manual input)", async () => {
    const ctx = testContext({ connectors: mockRegistry() });
    const { run } = await createResearch(ctx, { input: "日本の旅行市場で不満を調べる" });
    const result = await runResearchPipeline(ctx, run.id);
    expect(result.status).toBe("COMPLETED");
    const connectorRuns = await ctx.repos.ops.listConnectorRuns(run.id);
    const byKey = Object.fromEntries(connectorRuns.map((c) => [c.connectorKey, c.status]));
    expect(byKey).toMatchObject({ web_search: "SUCCESS", estat: "SUCCESS", x: "SUCCESS", google_places: "SKIPPED", tripadvisor: "SKIPPED" });
    expect(connectorRuns.find((c) => c.connectorKey === "web_search")?.costUsd).toBeGreaterThan(0);

    const items = await ctx.repos.evidence.listSourceItems(run.id);
    expect(items.length).toBeGreaterThanOrEqual(10);
    for (const i of items) {
      expect(i.metadata?.synthetic).toBe(true);
      expect(i.sourceName.startsWith("[MOCK]")).toBe(true);
      expect(i.language).toBe("ja");
      expect(i.country).toBe("JP");
    }
    expect(items.some((i) => i.sourceType === "STATISTIC")).toBe(true);

    const signals = await ctx.repos.signals.listSignals({ runId: run.id });
    expect(signals.length).toBeGreaterThan(5);
    expect(signals.every((s) => s.fieldProvenance?.problem === "FACT")).toBe(true);
    expect(await ctx.repos.ops.spendByRun(run.id)).toBeGreaterThan(0);
  });

  it("X FAILED / Web SUCCESS / e-Stat SUCCESS → PARTIAL_SUCCESS with results", async () => {
    const ctx = testContext({ connectors: mockRegistry(["x"]) });
    const { run } = await createResearch(ctx, { input: "日本の旅行市場で不満を調べる" });
    const result = await runResearchPipeline(ctx, run.id);
    expect(result.status).toBe("PARTIAL_SUCCESS");
    expect(result.stats.connectorsFailed).toEqual(["x"]);
    expect(result.stats.connectorsSucceeded).toEqual(expect.arrayContaining(["web_search", "estat"]));
    expect(result.stats.signals).toBeGreaterThan(0);
  });

  it("source preferences restrict which connectors run", async () => {
    const ctx = testContext({ connectors: mockRegistry() });
    const { run } = await createResearch(ctx, { input: "日本の旅行の不満", sourcePreferences: ["estat"] });
    await runResearchPipeline(ctx, run.id);
    expect((await ctx.repos.ops.listConnectorRuns(run.id)).map((c) => c.connectorKey)).toEqual(["estat"]);
  });

  it("an org can disable a connector or make it stricter, never looser", async () => {
    const ctx = testContext({ connectors: mockRegistry() });
    await updateConnectorSetting(ctx, { connectorKey: "x", enabled: false });
    await expect(updateConnectorSetting(ctx, { connectorKey: "google_places", enabled: true, complianceStatus: "APPROVED" })).rejects.toThrow(/緩める/);
    await updateConnectorSetting(ctx, { connectorKey: "estat", enabled: true, complianceStatus: "RESTRICTED", termsNotes: "社内確認待ち" });
    const { run } = await createResearch(ctx, { input: "日本の旅行の不満" });
    await runResearchPipeline(ctx, run.id);
    const byKey = Object.fromEntries((await ctx.repos.ops.listConnectorRuns(run.id)).map((c) => [c.connectorKey, c]));
    expect(byKey.x.status).toBe("SKIPPED");
    expect(byKey.estat.status).toBe("SKIPPED");
    expect(byKey.estat.error).toContain("RESTRICTED");
    expect(byKey.web_search.status).toBe("SUCCESS");
    const member = testContext({ db: ctx.db, actor: { ...ctx.actor, role: "member" }, connectors: mockRegistry() });
    await expect(updateConnectorSetting(member, { connectorKey: "x", enabled: true })).rejects.toThrow(/Not allowed/);
  });

  it("manual URL import failures are reported, not silent", async () => {
    const manual = new ManualImportConnector(async (url) => {
      if (url.includes("bad")) throw new Error("boom");
      return { url, title: "記事", text: "空港からの移動が分かりにくい。毎回迷う。" };
    });
    const ctx = testContext({ connectors: [manual] });
    const { run } = await createResearch(ctx, { input: "旅行の不満", manualUrls: ["https://ok.example/a", "https://bad.example/b"] });
    const result = await runResearchPipeline(ctx, run.id, { manualUrls: ["https://ok.example/a", "https://bad.example/b"] });
    expect(result.status).toBe("PARTIAL_SUCCESS");
    const cr = (await ctx.repos.ops.listConnectorRuns(run.id))[0];
    expect(cr.status).toBe("PARTIAL");
    expect(cr.error).toContain("bad.example");
    expect(result.stats.sourceItems).toBe(1);
  });
});
