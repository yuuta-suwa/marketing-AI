import type { ComplianceProfile } from "@/domain/compliance/compliance";
import { fetchJson, isoOrUndefined, processEnv, type EnvReader, type FetchLike } from "../http";
import type { SearchProvider, SearchQuery, SearchResult } from "./search-provider";

type BraveResponse = {
  web?: { results?: Array<{ url: string; title?: string; description?: string; extra_snippets?: string[]; page_age?: string; language?: string }> };
};

/**
 * Brave Search API (official). Storing results requires a plan whose terms
 * permit it; the operator confirms with WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true.
 */
export class BraveSearchProvider implements SearchProvider {
  readonly id = "brave";
  readonly name = "Brave Search API";
  readonly costPerQueryUsd = 0.005;
  readonly env = [
    { name: "BRAVE_SEARCH_API_KEY", description: "Brave Search API subscription token", secret: true },
    { name: "WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED", description: "true when your API plan permits storing results", secret: false },
  ] as const;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly env_: EnvReader = processEnv,
  ) {}

  configured(): boolean {
    return Boolean(this.env_("BRAVE_SEARCH_API_KEY"));
  }

  compliance(): ComplianceProfile {
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

  async search(q: SearchQuery): Promise<SearchResult[]> {
    const key = this.env_("BRAVE_SEARCH_API_KEY");
    if (!key) return [];
    const params = new URLSearchParams({ q: q.query, count: String(Math.min(20, q.count)), extra_snippets: "true" });
    if (q.language) params.set("search_lang", q.language);
    if (q.country) params.set("country", q.country.toLowerCase());
    const data = await fetchJson<BraveResponse>("web_search", this.fetchImpl, `https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: "application/json", "X-Subscription-Token": key },
      signal: q.signal,
    });
    return (data.web?.results ?? []).map((r) => ({
      url: r.url,
      title: r.title,
      snippets: [r.description, ...(r.extra_snippets ?? [])].filter((x): x is string => Boolean(x)),
      publishedAt: isoOrUndefined(r.page_age),
      language: r.language,
    }));
  }
}
