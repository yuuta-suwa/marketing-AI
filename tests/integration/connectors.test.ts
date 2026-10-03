import { describe, expect, it } from "vitest";
import { createDefaultConnectorRegistry } from "@/connectors/registry";
import { EStatConnector } from "@/connectors/estat";
import { WebSearchConnector } from "@/connectors/web-search";
import { BraveSearchProvider } from "@/connectors/search/brave";
import { XConnector } from "@/connectors/x";
import { GooglePlacesConnector } from "@/connectors/google-places";
import { ConnectorError } from "@/domain/connector/connector";
import { parseDirectiveByRules } from "@/domain/research/directive-parser";
import { RawSourceItemSchema } from "@/domain/source/source-item";
import { parseManualInput } from "@/application/research/manual-input";

const directive = parseDirectiveByRules({ input: "日本の旅行 空港 移動 不便" });
const ctx = { researchRunId: "r", organizationId: "o", limit: 10 };
const env = (vars: Record<string, string>) => (k: string) => vars[k];
const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("connector compliance defaults", () => {
  const registry = createDefaultConnectorRegistry({ env: () => undefined, fetch: json({}) });

  it("only manual import and e-Stat are APPROVED out of the box", () => {
    const approved = registry.list().filter((c) => c.complianceStatus().status === "APPROVED").map((c) => c.id);
    expect(approved.sort()).toEqual(["estat", "manual_import"]);
  });

  it("future connectors and Yahoo!知恵袋 are DISABLED_PENDING_COMPLIANCE and cannot search", async () => {
    for (const id of ["instagram", "reddit", "marketplace", "yahoo_chiebukuro"]) {
      const c = registry.get(id)!;
      expect(c.complianceStatus().status).toBe("DISABLED_PENDING_COMPLIANCE");
      await expect(c.search(directive, ctx)).rejects.toBeInstanceOf(ConnectorError);
    }
  });

  it("Google Places and Tripadvisor stay PENDING_REVIEW even with credentials", () => {
    const r = createDefaultConnectorRegistry({ env: env({ GOOGLE_PLACES_API_KEY: "k", TRIPADVISOR_API_KEY: "k" }), fetch: json({}) });
    expect(r.get("google_places")!.complianceStatus().status).toBe("PENDING_REVIEW");
    expect(r.get("tripadvisor")!.complianceStatus().status).toBe("PENDING_REVIEW");
  });

  it("web search / X need an explicit operator confirmation to become APPROVED", () => {
    expect(new WebSearchConnector(new BraveSearchProvider(json({}), env({ BRAVE_SEARCH_API_KEY: "k" }))).complianceStatus().status).toBe("PENDING_REVIEW");
    expect(new WebSearchConnector(new BraveSearchProvider(json({}), env({ BRAVE_SEARCH_API_KEY: "k", WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED: "true" }))).complianceStatus().status).toBe("APPROVED");
    expect(new XConnector(json({}), env({ X_TERMS_CONFIRMED: "true" })).complianceStatus().status).toBe("APPROVED");
  });

  it("health checks report missing credentials", async () => {
    expect((await registry.get("web_search")!.healthCheck()).status).toBe("NOT_CONFIGURED");
    expect((await registry.get("manual_import")!.healthCheck()).status).toBe("HEALTHY");
  });
});

describe("adapters normalize provider responses (mocked HTTP)", () => {
  it("web search maps snippets only", async () => {
    let calledUrl = "";
    const fetchImpl = async (url: string) => {
      calledUrl = url;
      return new Response(JSON.stringify({ web: { results: [{ url: "https://ex.com/a", title: "T", description: "空港の移動が不便", extra_snippets: ["困った"] }] } }));
    };
    const items = await new WebSearchConnector(new BraveSearchProvider(fetchImpl, env({ BRAVE_SEARCH_API_KEY: "k" }))).search(directive, ctx);
    expect(calledUrl).toContain("api.search.brave.com");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sourceType: "WEB", sourceName: "ex.com", body: "空港の移動が不便\n困った" });
    expect(RawSourceItemSchema.safeParse(items[0]).success).toBe(true);
  });

  it("e-Stat maps statistics tables with attribution", async () => {
    const items = await new EStatConnector(
      json({ GET_STATS_LIST: { RESULT: { STATUS: 0 }, DATALIST_INF: { TABLE_INF: { "@id": "000123", STATISTICS_NAME: "旅行・観光消費動向調査", TITLE: { $: "旅行者数" }, GOV_ORG: { $: "観光庁" }, SURVEY_DATE: 202501 } } } }),
      env({ ESTAT_APP_ID: "id" }),
    ).search(directive, ctx);
    expect(items[0]).toMatchObject({ sourceType: "STATISTIC", externalId: "000123", country: "JP" });
    expect(items[0].metadata?.attribution).toContain("e-Stat");
  });

  it("X maps posts with external ids", async () => {
    const items = await new XConnector(json({ data: [{ id: "99", text: "予約が取れない", lang: "ja", created_at: "2026-09-01T00:00:00.000Z" }] }), env({ X_BEARER_TOKEN: "t" })).search(directive, ctx);
    expect(items[0]).toMatchObject({ sourceType: "POST", externalId: "99", sourceUrl: "https://x.com/i/web/status/99" });
  });

  it("Google Places maps reviews", async () => {
    const items = await new GooglePlacesConnector(
      json({ places: [{ id: "p1", displayName: { text: "駅" }, reviews: [{ name: "places/p1/reviews/r1", text: { text: "ロッカーが足りない" }, rating: 2 }] }] }),
      env({ GOOGLE_PLACES_API_KEY: "k" }),
    ).search(directive, ctx);
    expect(items[0]).toMatchObject({ sourceType: "REVIEW", externalId: "places/p1/reviews/r1" });
  });

  it("HTTP 429 / 5xx are retryable connector errors, 4xx are not", async () => {
    const c429 = new WebSearchConnector(new BraveSearchProvider(json({}, 429), env({ BRAVE_SEARCH_API_KEY: "k" })));
    await expect(c429.search(directive, ctx)).rejects.toMatchObject({ retryable: true, status: 429 });
    const c401 = new WebSearchConnector(new BraveSearchProvider(json({}, 401), env({ BRAVE_SEARCH_API_KEY: "k" })));
    await expect(c401.search(directive, ctx)).rejects.toMatchObject({ retryable: false, status: 401 });
  });

  it("adapters without credentials return nothing instead of calling out", async () => {
    let called = false;
    const items = await new WebSearchConnector(new BraveSearchProvider(async () => { called = true; return new Response("{}"); }, env({}))).search(directive, ctx);
    expect(items).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("manual input parsing", () => {
  it("splits by blank lines and reads source labels", () => {
    const items = parseManualInput("source: 顧客A\n空港が遠い。\n\n  \n出典：アンケート\nロッカーが足りない\n\nただの文");
    expect(items).toEqual([
      { sourceName: "顧客A", body: "空港が遠い。" },
      { sourceName: "アンケート", body: "ロッカーが足りない" },
      { sourceName: "Manual Import", body: "ただの文" },
    ]);
  });
});
