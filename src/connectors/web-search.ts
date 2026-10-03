import type { ComplianceProfile } from "@/domain/compliance/compliance";
import type { ConnectorContext, ConnectorHealth, MarketConnector } from "@/domain/connector/connector";
import type { CostEstimate } from "@/domain/cost/cost";
import type { ResearchDirective } from "@/domain/research/directive";
import type { RawSourceItem } from "@/domain/source/source-item";
import { buildQuery, fetchJson, isoOrUndefined, processEnv, type EnvReader, type FetchLike } from "./http";

type BraveResponse = {
  web?: {
    results?: Array<{
      url: string;
      title?: string;
      description?: string;
      extra_snippets?: string[];
      page_age?: string;
      language?: string;
    }>;
  };
};

/**
 * Web search through the official Brave Search API.
 * Storing results requires a plan whose terms permit storage; the operator
 * confirms that with WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true, otherwise the
 * connector stays PENDING_REVIEW and does not run.
 */
export class WebSearchConnector implements MarketConnector {
  readonly id = "web_search";
  readonly name = "Web Search (Brave Search API)";
  readonly category = "WEB" as const;
  readonly description = "公式Search APIによるWeb検索（スニペットのみ取得、ページ本文はクロールしない）";
  readonly env = [
    { name: "BRAVE_SEARCH_API_KEY", description: "Brave Search API subscription token", secret: true },
    {
      name: "WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED",
      description: "true when your API plan permits storing results",
      secret: false,
    },
  ] as const;
  readonly sourceQuality = 0.5;
  readonly enabledByDefault = true;
  readonly credentialsRequired = true;
  static readonly COST_PER_QUERY_USD = 0.005;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly env_: EnvReader = processEnv,
  ) {}

  credentialsPresent(): boolean {
    return Boolean(this.env_("BRAVE_SEARCH_API_KEY"));
  }

  async search(directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
    const key = this.env_("BRAVE_SEARCH_API_KEY");
    if (!key) return [];
    const params = new URLSearchParams({
      q: buildQuery(directive.keywords, directive.objective),
      count: String(Math.min(20, context.limit)),
      extra_snippets: "true",
    });
    const lang = directive.languages[0];
    if (lang) params.set("search_lang", lang);
    const country = directive.countries.find((c) => c !== "GLOBAL");
    if (country) params.set("country", country.toLowerCase());

    const data = await fetchJson<BraveResponse>(this.id, this.fetchImpl, `https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal: context.signal,
    });
    return (data.web?.results ?? []).slice(0, context.limit).flatMap((r) => {
      const body = [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join("\n");
      if (!body) return [];
      return [
        {
          sourceType: "WEB",
          sourceName: new URL(r.url).hostname,
          sourceUrl: r.url,
          title: r.title,
          body,
          language: r.language,
          country,
          publishedAt: isoOrUndefined(r.page_age),
          metadata: { provider: "brave", snippetOnly: true },
        } satisfies RawSourceItem,
      ];
    });
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.credentialsPresent()) return { status: "NOT_CONFIGURED", message: "BRAVE_SEARCH_API_KEY 未設定", checkedAt };
    return { status: "HEALTHY", checkedAt };
  }

  complianceStatus(): ComplianceProfile {
    const confirmed = this.env_("WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED") === "true";
    return {
      status: confirmed ? "APPROVED" : "PENDING_REVIEW",
      accessMethod: "OFFICIAL_API",
      termsUrl: "https://api-dashboard.search.brave.com/terms-of-service",
      notes: confirmed
        ? "公式API。保存権限のあるプランであることを運用者が確認済み。"
        : "公式APIだが、結果の保存可否は契約プランに依存。確認後 WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true を設定。",
      prohibitions: ["検索結果ページのスクレイピング", "検索結果リンク先の無断クロール"],
    };
  }

  async estimateCost(): Promise<CostEstimate> {
    return { amountUsd: WebSearchConnector.COST_PER_QUERY_USD, basis: "1 query" };
  }
}
