import type { ComplianceProfile } from "@/domain/compliance/compliance";
import { ConnectorError, type ConnectorContext, type ConnectorHealth, type MarketConnector } from "@/domain/connector/connector";
import type { CostEstimate } from "@/domain/cost/cost";
import type { ResearchDirective } from "@/domain/research/directive";
import type { RawSourceItem } from "@/domain/source/source-item";
import { buildQuery, fetchJson, processEnv, type EnvReader, type FetchLike } from "./http";

type XSearchResponse = {
  data?: Array<{
    id: string;
    text: string;
    lang?: string;
    created_at?: string;
    public_metrics?: Record<string, number>;
  }>;
};

/**
 * X (Twitter) API v2 recent search with an app bearer token.
 * Content terms (deletion compliance, display rules) depend on the access
 * tier; the operator confirms review with X_TERMS_CONFIRMED=true.
 */
export class XConnector implements MarketConnector {
  readonly id = "x";
  readonly name = "X (API v2)";
  readonly category = "SOCIAL" as const;
  readonly description = "X API v2 Recent Searchで直近の投稿を取得（公式API・削除への追従が必要）";
  readonly env = [
    { name: "X_BEARER_TOKEN", description: "X API v2 app-only bearer token", secret: true },
    { name: "X_TERMS_CONFIRMED", description: "true after reviewing X Developer Agreement for your tier", secret: false },
  ] as const;
  readonly sourceQuality = 0.35;
  readonly enabledByDefault = false;
  readonly credentialsRequired = true;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly env_: EnvReader = processEnv,
  ) {}

  credentialsPresent(): boolean {
    return Boolean(this.env_("X_BEARER_TOKEN"));
  }

  async search(directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
    const token = this.env_("X_BEARER_TOKEN");
    if (!token) return [];
    const lang = directive.languages[0];
    const negatives = directive.negativeKeywords.map((k) => `-${k}`).join(" ");
    const query = `${buildQuery(directive.keywords, directive.objective, 4)} ${negatives} -is:retweet${lang ? ` lang:${lang}` : ""}`.trim();
    const params = new URLSearchParams({
      query: query.slice(0, 512),
      max_results: String(Math.max(10, Math.min(100, context.limit))),
      "tweet.fields": "created_at,lang,public_metrics",
    });
    const data = await fetchJson<XSearchResponse>(this.id, this.fetchImpl, `https://api.x.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: context.signal,
    });
    return (data.data ?? []).slice(0, context.limit).map((t) => ({
      sourceType: "POST",
      sourceName: "X",
      sourceUrl: `https://x.com/i/web/status/${t.id}`,
      externalId: t.id,
      body: t.text,
      language: t.lang,
      publishedAt: t.created_at,
      engagement: t.public_metrics,
      metadata: { provider: "x-api-v2" },
    }));
  }

  /** Smallest permitted page (10 posts) — consumes read quota on metered tiers. */
  async smokeTest(signal?: AbortSignal): Promise<{ detail: string; costUsd: number }> {
    const token = this.env_("X_BEARER_TOKEN");
    if (!token) throw new ConnectorError(this.id, "X_BEARER_TOKEN not configured", false);
    const params = new URLSearchParams({ query: "travel -is:retweet", max_results: "10" });
    const data = await fetchJson<XSearchResponse>(this.id, this.fetchImpl, `https://api.x.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      timeoutMs: 10_000,
    });
    return { detail: `${data.data?.length ?? 0} post(s)`, costUsd: 0 };
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.credentialsPresent()) return { status: "NOT_CONFIGURED", message: "X_BEARER_TOKEN 未設定", checkedAt };
    return { status: "HEALTHY", checkedAt };
  }

  complianceStatus(): ComplianceProfile {
    const confirmed = this.env_("X_TERMS_CONFIRMED") === "true";
    return {
      status: confirmed ? "APPROVED" : "PENDING_REVIEW",
      accessMethod: "OFFICIAL_API",
      termsUrl: "https://developer.x.com/en/developer-terms/agreement-and-policy",
      notes: "公式APIのみ。削除・非公開化された投稿への追従（保存データの削除）が必要。",
      prohibitions: ["Webスクレイピング", "非公開アカウントの取得", "個人のプロファイリング"],
    };
  }

  async estimateCost(): Promise<CostEstimate> {
    return { amountUsd: 0, basis: "tier-dependent (fixed monthly plan)" };
  }
}
