import type { ComplianceProfile } from "@/domain/compliance/compliance";
import { ConnectorError, type ConnectorContext, type ConnectorHealth, type MarketConnector } from "@/domain/connector/connector";
import type { CostEstimate } from "@/domain/cost/cost";
import type { ResearchDirective } from "@/domain/research/directive";
import type { RawSourceItem } from "@/domain/source/source-item";
import { fetchJson, processEnv, type EnvReader, type FetchLike } from "./http";

type Text = string | { $: string } | undefined;
type StatTable = {
  "@id": string;
  STAT_NAME?: Text;
  GOV_ORG?: Text;
  STATISTICS_NAME?: string;
  TITLE?: Text;
  SURVEY_DATE?: string | number;
  OPEN_DATE?: string;
  UPDATED_DATE?: string;
};
type EStatListResponse = {
  GET_STATS_LIST?: {
    RESULT?: { STATUS: number; ERROR_MSG?: string };
    DATALIST_INF?: { TABLE_INF?: StatTable | StatTable[] };
  };
};

const text = (t: Text): string | undefined => (typeof t === "string" ? t : t?.$);

/**
 * e-Stat (政府統計の総合窓口) official API. Returns official statistics
 * tables relevant to the directive as STATISTIC evidence (table metadata —
 * numeric values are fetched later by QuantAnalyst with explicit citations).
 */
export class EStatConnector implements MarketConnector {
  readonly id = "estat";
  readonly name = "e-Stat (政府統計)";
  readonly category = "PUBLIC" as const;
  readonly description = "e-Stat APIで関連する公的統計表を検索（出典表示が必要）";
  readonly env = [{ name: "ESTAT_APP_ID", description: "e-Stat API アプリケーションID", secret: true }] as const;
  readonly sourceQuality = 0.95;
  readonly enabledByDefault = true;
  readonly credentialsRequired = true;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly env_: EnvReader = processEnv,
  ) {}

  credentialsPresent(): boolean {
    return Boolean(this.env_("ESTAT_APP_ID"));
  }

  async search(directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
    const appId = this.env_("ESTAT_APP_ID");
    if (!appId) return [];
    if (directive.countries.length > 0 && !directive.countries.includes("JP")) return [];
    const searchWord = directive.keywords.filter((k) => /[぀-ヿ一-鿿]/.test(k)).slice(0, 3).join(" OR ");
    if (!searchWord) return [];
    const params = new URLSearchParams({
      appId,
      lang: "J",
      searchWord,
      limit: String(Math.min(20, context.limit)),
    });
    const data = await fetchJson<EStatListResponse>(
      this.id,
      this.fetchImpl,
      `https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList?${params}`,
      { signal: context.signal },
    );
    const status = data.GET_STATS_LIST?.RESULT?.STATUS;
    if (status !== undefined && status > 2) {
      throw new Error(`e-Stat error ${status}: ${data.GET_STATS_LIST?.RESULT?.ERROR_MSG ?? ""}`);
    }
    const raw = data.GET_STATS_LIST?.DATALIST_INF?.TABLE_INF;
    const tables = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    return tables.slice(0, context.limit).map((t) => {
      const title = text(t.TITLE) ?? t.STATISTICS_NAME ?? "統計表";
      const org = text(t.GOV_ORG);
      return {
        sourceType: "STATISTIC",
        sourceName: `e-Stat${org ? ` / ${org}` : ""}`,
        sourceUrl: `https://www.e-stat.go.jp/dbview?sid=${encodeURIComponent(t["@id"])}`,
        externalId: t["@id"],
        title,
        body: [text(t.STAT_NAME), t.STATISTICS_NAME, title, t.SURVEY_DATE ? `調査年月: ${t.SURVEY_DATE}` : undefined]
          .filter(Boolean)
          .join("\n"),
        language: "ja",
        country: "JP",
        publishedAt: t.OPEN_DATE ? new Date(t.OPEN_DATE).toISOString() : undefined,
        metadata: { provider: "e-stat", attribution: "出典：政府統計の総合窓口(e-Stat)" },
      } satisfies RawSourceItem;
    });
  }

  async smokeTest(signal?: AbortSignal): Promise<{ detail: string; costUsd: number }> {
    const appId = this.env_("ESTAT_APP_ID");
    if (!appId) throw new ConnectorError(this.id, "ESTAT_APP_ID not configured", false);
    const params = new URLSearchParams({ appId, lang: "J", searchWord: "観光", limit: "1" });
    const data = await fetchJson<EStatListResponse>(this.id, this.fetchImpl, `https://api.e-stat.go.jp/rest/3.0/app/json/getStatsList?${params}`, {
      signal,
      timeoutMs: 10_000,
    });
    const result = data.GET_STATS_LIST?.RESULT;
    // STATUS 0-2 are success codes; 100+ are errors (e.g. invalid appId).
    if (!result || result.STATUS > 2) {
      throw new ConnectorError(this.id, `e-Stat error ${result?.STATUS ?? "?"}: ${result?.ERROR_MSG ?? "no RESULT"}`, false, result?.STATUS === 100 ? 401 : undefined);
    }
    return { detail: `STATUS ${result.STATUS}`, costUsd: 0 };
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.credentialsPresent()) return { status: "NOT_CONFIGURED", message: "ESTAT_APP_ID 未設定", checkedAt };
    return { status: "HEALTHY", checkedAt };
  }

  complianceStatus(): ComplianceProfile {
    return {
      status: "APPROVED",
      accessMethod: "OFFICIAL_API",
      termsUrl: "https://www.e-stat.go.jp/api/agreement/",
      notes: "公式API。利用時はクレジット表示（出典：政府統計の総合窓口(e-Stat)）が必要。",
      prohibitions: ["API利用規約に反する大量リクエスト"],
    };
  }

  async estimateCost(): Promise<CostEstimate> {
    return { amountUsd: 0, basis: "e-Stat API is free (attribution required)" };
  }
}
