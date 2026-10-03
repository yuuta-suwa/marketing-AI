import type { ComplianceProfile } from "@/domain/compliance/compliance";
import type { ConnectorContext, ConnectorHealth, MarketConnector } from "@/domain/connector/connector";
import type { CostEstimate } from "@/domain/cost/cost";
import type { ResearchDirective } from "@/domain/research/directive";
import type { RawSourceItem } from "@/domain/source/source-item";
import { buildQuery, fetchJson, isoOrUndefined, processEnv, type EnvReader, type FetchLike } from "./http";

type LocationSearch = { data?: Array<{ location_id: string; name: string }> };
type Reviews = {
  data?: Array<{ id: number; text?: string; title?: string; lang?: string; published_date?: string; rating?: number; url?: string }>;
};

/**
 * Tripadvisor Content API. PENDING_REVIEW: the Content API is licensed for
 * display on the licensee's site with attribution; analytical storage needs
 * explicit permission from Tripadvisor before this connector may run.
 */
export class TripadvisorConnector implements MarketConnector {
  readonly id = "tripadvisor";
  readonly name = "Tripadvisor Content API";
  readonly category = "TRAVEL" as const;
  readonly description = "Tripadvisor Content APIで施設レビューを取得（利用許諾の確認待ち）";
  readonly env = [{ name: "TRIPADVISOR_API_KEY", description: "Tripadvisor Content API key", secret: true }] as const;
  readonly sourceQuality = 0.5;
  readonly enabledByDefault = false;
  readonly credentialsRequired = true;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly env_: EnvReader = processEnv,
  ) {}

  credentialsPresent(): boolean {
    return Boolean(this.env_("TRIPADVISOR_API_KEY"));
  }

  async search(directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
    const key = this.env_("TRIPADVISOR_API_KEY");
    if (!key) return [];
    const lang = directive.languages[0] ?? "ja";
    const base = "https://api.content.tripadvisor.com/api/v1";
    const search = await fetchJson<LocationSearch>(
      this.id,
      this.fetchImpl,
      `${base}/location/search?${new URLSearchParams({ key, searchQuery: buildQuery(directive.keywords, directive.objective, 3), language: lang })}`,
      { headers: { accept: "application/json" }, signal: context.signal },
    );
    const items: RawSourceItem[] = [];
    for (const loc of (search.data ?? []).slice(0, 3)) {
      const reviews = await fetchJson<Reviews>(
        this.id,
        this.fetchImpl,
        `${base}/location/${encodeURIComponent(loc.location_id)}/reviews?${new URLSearchParams({ key, language: lang })}`,
        { headers: { accept: "application/json" }, signal: context.signal },
      );
      for (const r of reviews.data ?? []) {
        if (!r.text) continue;
        items.push({
          sourceType: "REVIEW",
          sourceName: `Tripadvisor / ${loc.name}`,
          sourceUrl: r.url,
          externalId: String(r.id),
          title: r.title,
          body: r.text,
          language: r.lang,
          publishedAt: isoOrUndefined(r.published_date),
          engagement: { rating: r.rating },
          metadata: { provider: "tripadvisor", locationId: loc.location_id, attributionRequired: true },
        });
      }
    }
    return items.slice(0, context.limit);
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.credentialsPresent()) return { status: "NOT_CONFIGURED", message: "TRIPADVISOR_API_KEY 未設定", checkedAt };
    return { status: "HEALTHY", checkedAt };
  }

  complianceStatus(): ComplianceProfile {
    return {
      status: "PENDING_REVIEW",
      accessMethod: "OFFICIAL_API",
      termsUrl: "https://tripadvisor-content-api.readme.io/reference/overview",
      notes: "Content APIは自社サイトでの表示用途が前提。分析目的の保存はTripadvisorの許諾確認後に有効化。",
      prohibitions: ["Tripadvisorサイトのスクレイピング", "帰属表示の削除"],
    };
  }

  async estimateCost(): Promise<CostEstimate> {
    return { amountUsd: 0, basis: "Content API free tier (quota-limited)" };
  }
}
