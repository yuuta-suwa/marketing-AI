import type { ComplianceProfile } from "@/domain/compliance/compliance";
import type { ConnectorContext, ConnectorHealth, MarketConnector } from "@/domain/connector/connector";
import type { CostEstimate } from "@/domain/cost/cost";
import type { ResearchDirective } from "@/domain/research/directive";
import type { RawSourceItem } from "@/domain/source/source-item";
import { buildQuery } from "./http";
import type { SearchProvider } from "./search/search-provider";

/**
 * Web search connector over a pluggable SearchProvider. Only snippets
 * returned by the provider are stored; result pages are never crawled.
 */
export class WebSearchConnector implements MarketConnector {
  readonly id = "web_search";
  readonly category = "WEB" as const;
  readonly description = "検索プロバイダAPIによるWeb検索（スニペットのみ取得、ページ本文はクロールしない）";
  readonly sourceQuality = 0.5;
  readonly enabledByDefault = true;
  readonly credentialsRequired = true;

  constructor(private readonly provider: SearchProvider) {}

  get name(): string {
    return `Web Search (${this.provider.name})`;
  }

  get env() {
    return this.provider.env;
  }

  credentialsPresent(): boolean {
    return this.provider.configured();
  }

  async search(directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
    if (!this.provider.configured()) return [];
    const country = directive.countries.find((c) => c !== "GLOBAL");
    const results = await this.provider.search({
      query: buildQuery(directive.keywords, directive.objective),
      count: context.limit,
      language: directive.languages[0],
      country,
      signal: context.signal,
    });
    return results.slice(0, context.limit).flatMap((r) => {
      const body = r.snippets.join("\n");
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
          publishedAt: r.publishedAt,
          metadata: { provider: this.provider.id, snippetOnly: true },
        } satisfies RawSourceItem,
      ];
    });
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.provider.configured()) {
      return { status: "NOT_CONFIGURED", message: `${this.provider.env[0]?.name ?? "credentials"} 未設定`, checkedAt };
    }
    return { status: "HEALTHY", checkedAt };
  }

  complianceStatus(): ComplianceProfile {
    return this.provider.compliance();
  }

  async estimateCost(): Promise<CostEstimate> {
    return { amountUsd: this.provider.costPerQueryUsd, basis: `1 query (${this.provider.id})` };
  }
}
