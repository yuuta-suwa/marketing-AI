import type { ConnectorContext, MarketConnector } from "@/domain/connector/connector";
import type { ResearchDirective } from "@/domain/research/directive";
import type { RawSourceItem } from "@/domain/source/source-item";
import type { EnvReader, FetchLike } from "./http";

/**
 * MOCK CONNECTOR MODE — demo/E2E only (never in Supabase mode).
 * The real adapters run against canned HTTP responses below, so parsing,
 * normalization, dedup and the compliance gate are exercised end to end.
 * Every item is flagged `metadata.synthetic = true` and its source name is
 * prefixed with [MOCK]; the texts are invented samples, not market evidence.
 */

const WEB_RESULTS = [
  ["https://travel-forum.example/airport-access", "空港アクセスの不満", "空港から市内への移動が分かりにくい。乗り換え案内が少なく毎回迷う。"],
  ["https://travel-forum.example/luggage", "荷物預け", "駅のコインロッカーが足りない。大きな荷物を預ける場所がなく困っている。有料でも預かってほしい。"],
  ["https://blog.example/ryokan-booking", "旅館予約", "人気の旅館は予約が取れない。空きが出たら通知してほしい。お金を払ってもいい。"],
  ["https://news.example/inbound-language", "多言語対応", "地方の観光地は英語の案内がない。外国人観光客が情報不足で困っている。"],
  ["https://qa.example/taxi-price", "タクシー料金", "深夜のタクシーが高すぎる。ほかに移動手段がなく仕方なく使っている。"],
  ["https://travel-forum.example/crowd", "混雑", "有名観光地は混雑がひどく、行列で待ち時間が長い。空いている時間が分からない。"],
] as const;

const X_POSTS = [
  ["1001", "空港の乗り換えが分かりにくすぎる。毎回迷う。"],
  ["1002", "コインロッカーが足りない…荷物を持ったまま観光するのつらい"],
  ["1003", "旅館の予約が取れない。キャンセル待ちの通知サービスがあれば払う"],
  ["1004", "観光地の待ち時間が長すぎる。混雑状況が分かればいいのに"],
] as const;

const ESTAT_TABLES = [
  { "@id": "MOCK0001", STATISTICS_NAME: "[MOCK] 旅行・観光消費動向調査", TITLE: { $: "[MOCK] 国内旅行者数" }, GOV_ORG: { $: "[MOCK] 観光庁" }, SURVEY_DATE: 202606 },
  { "@id": "MOCK0002", STATISTICS_NAME: "[MOCK] 宿泊旅行統計調査", TITLE: { $: "[MOCK] 延べ宿泊者数" }, GOV_ORG: { $: "[MOCK] 観光庁" }, SURVEY_DATE: 202607 },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createMockFetch(options: { fail?: string[] } = {}): FetchLike {
  const fail = new Set(options.fail ?? []);
  return async (input) => {
    const url = new URL(input);
    const now = Date.now();
    if (url.hostname === "api.search.brave.com") {
      if (fail.has("web_search")) return json({ error: "mock failure" }, 503);
      return json({
        web: {
          results: WEB_RESULTS.map(([u, title, description], i) => ({
            url: u,
            title,
            description,
            page_age: new Date(now - (i + 1) * 4 * 86_400_000).toISOString(),
            language: "ja",
          })),
        },
      });
    }
    if (url.hostname === "api.x.com") {
      if (fail.has("x")) return json({ title: "mock failure" }, 503);
      return json({ data: X_POSTS.map(([id, text], i) => ({ id, text, lang: "ja", created_at: new Date(now - (i + 1) * 86_400_000).toISOString() })) });
    }
    if (url.hostname === "api.e-stat.go.jp") {
      if (fail.has("estat")) return json({}, 500);
      return json({ GET_STATS_LIST: { RESULT: { STATUS: 0 }, DATALIST_INF: { TABLE_INF: ESTAT_TABLES } } });
    }
    return json({ error: "not mocked" }, 404);
  };
}

/** Env with placeholder credentials so adapters consider themselves configured. */
export function mockEnv(base: EnvReader): EnvReader {
  const fake: Record<string, string> = {
    BRAVE_SEARCH_API_KEY: "mock",
    WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED: "true",
    ESTAT_APP_ID: "mock",
    X_BEARER_TOKEN: "mock",
    X_TERMS_CONFIRMED: "true",
    GOOGLE_PLACES_API_KEY: "mock",
    TRIPADVISOR_API_KEY: "mock",
  };
  return (name) => fake[name] ?? base(name);
}

/** Wraps a connector so everything it returns is visibly synthetic. */
export function markSynthetic(connector: MarketConnector): MarketConnector {
  if (connector.id === "manual_import") return connector;
  const search = connector.search.bind(connector);
  return Object.assign(Object.create(Object.getPrototypeOf(connector)) as MarketConnector, connector, {
    // Mocked connectors cost nothing and touch no external service: on by default
    // (the compliance gate still applies, so PENDING_REVIEW sources stay off).
    enabledByDefault: true,
    synthetic: true,
    // Canned responses touch no paid API: never record spend for them.
    async estimateCost() {
      return { amountUsd: 0, basis: "MOCK connector (no external request)" };
    },
    smokeTest: undefined,
    async search(directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
      const items = await search(directive, context);
      return items.map((item) => ({
        ...item,
        sourceName: `[MOCK] ${item.sourceName}`,
        metadata: { ...item.metadata, synthetic: true },
      }));
    },
  });
}
