import type { ComplianceProfile } from "@/domain/compliance/compliance";
import type {
  ConnectorCategory,
  ConnectorHealth,
  EnvRequirement,
  MarketConnector,
} from "@/domain/connector/connector";
import { ConnectorError } from "@/domain/connector/connector";
import type { RawSourceItem } from "@/domain/source/source-item";

type ScaffoldSpec = {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  env: EnvRequirement[];
  sourceQuality: number;
  notes: string;
  termsUrl?: string;
};

/**
 * Placeholder for a future connector. It is registered so it appears in the
 * settings UI with its compliance requirements, but it can never collect
 * data: status is DISABLED_PENDING_COMPLIANCE and search() throws.
 */
export class ScaffoldConnector implements MarketConnector {
  readonly id: string;
  readonly name: string;
  readonly category: ConnectorCategory;
  readonly description: string;
  readonly env: readonly EnvRequirement[];
  readonly sourceQuality: number;
  readonly enabledByDefault = false;
  readonly credentialsRequired = true;
  private readonly notes: string;
  private readonly termsUrl?: string;

  constructor(spec: ScaffoldSpec) {
    this.id = spec.id;
    this.name = spec.name;
    this.category = spec.category;
    this.description = spec.description;
    this.env = spec.env;
    this.sourceQuality = spec.sourceQuality;
    this.notes = spec.notes;
    this.termsUrl = spec.termsUrl;
  }

  async search(): Promise<RawSourceItem[]> {
    throw new ConnectorError(this.id, `${this.name} is not implemented (DISABLED_PENDING_COMPLIANCE)`);
  }

  async healthCheck(): Promise<ConnectorHealth> {
    return { status: "UNAVAILABLE", message: "未実装（コンプライアンス確認待ち）", checkedAt: new Date().toISOString() };
  }

  complianceStatus(): ComplianceProfile {
    return {
      status: "DISABLED_PENDING_COMPLIANCE",
      accessMethod: "NONE",
      termsUrl: this.termsUrl,
      notes: this.notes,
      prohibitions: ["公式API・許諾が確認できるまで自動取得しない"],
    };
  }

  credentialsPresent(): boolean {
    return false;
  }
}

export const FUTURE_CONNECTORS: ScaffoldSpec[] = [
  { id: "instagram", name: "Instagram", category: "SOCIAL", description: "Instagram Graph API（ビジネスアカウント・許諾範囲のみ）", env: [{ name: "INSTAGRAM_ACCESS_TOKEN", description: "Graph API token", secret: true }], sourceQuality: 0.3, notes: "Graph APIは自社/許諾アカウント中心。一般投稿の収集は不可。" },
  { id: "reddit", name: "Reddit", category: "COMMUNITY", description: "Reddit Data API（商用利用は別途契約）", env: [{ name: "REDDIT_CLIENT_ID", description: "OAuth client id", secret: true }, { name: "REDDIT_CLIENT_SECRET", description: "OAuth client secret", secret: true }], sourceQuality: 0.4, notes: "商用・AI用途は Reddit との契約が必要。", termsUrl: "https://redditinc.com/policies/data-api-terms" },
  { id: "youtube", name: "YouTube", category: "SOCIAL", description: "YouTube Data API v3（コメント取得）", env: [{ name: "YOUTUBE_API_KEY", description: "API key", secret: true }], sourceQuality: 0.35, notes: "YouTube API Services規約のデータ保存期限・表示要件を確認する。", termsUrl: "https://developers.google.com/youtube/terms/api-services-terms-of-service" },
  { id: "commerce", name: "Commerce (EC公式API)", category: "COMMERCE", description: "楽天/Yahoo!ショッピング等の公式API（レビュー取得可否はAPI毎に確認）", env: [], sourceQuality: 0.5, notes: "API提供・許諾が確認できたマーケットプレイスのみ個別Connectorとして実装。" },
  { id: "marketplace", name: "Marketplace", category: "COMMERCE", description: "Amazon/メルカリ/eBay/Etsy 等", env: [], sourceQuality: 0.5, notes: "許諾・API提供が確認できないマーケットプレイスは自動取得対象外。" },
  { id: "ticket", name: "Ticket / Reservation", category: "TICKET", description: "チケット・予約サービス（提携API前提）", env: [], sourceQuality: 0.5, notes: "提携・API契約が前提。" },
  { id: "travel", name: "Travel OTA", category: "TRAVEL", description: "Booking / Expedia / Airbnb 等（パートナーAPI）", env: [], sourceQuality: 0.5, notes: "アフィリエイト/パートナー契約の範囲を確認。" },
  { id: "government", name: "Government / 制度", category: "PUBLIC", description: "官公庁・自治体・補助金・法改正（公開データ/RSS/API）", env: [], sourceQuality: 0.9, notes: "各サイトの利用規約・RSS/APIの提供を確認。" },
  { id: "app_review", name: "App Reviews", category: "APP_REVIEW", description: "App Store Connect / Google Play Developer API（自社アプリのみ）", env: [], sourceQuality: 0.5, notes: "公式APIは自社アプリのレビューに限定。他社アプリは対象外。" },
  { id: "job_market", name: "Job Market", category: "JOB_MARKET", description: "求人API（人手不足シグナル）", env: [], sourceQuality: 0.6, notes: "求人サイトのAPI/契約を確認。" },
  { id: "yahoo_chiebukuro", name: "Yahoo!知恵袋", category: "COMMUNITY", description: "旧公式APIは提供終了。前提にしない。", env: [], sourceQuality: 0.3, notes: "旧公式APIは利用不可。許諾された取得手段が確認できるまで無効。" },
];
