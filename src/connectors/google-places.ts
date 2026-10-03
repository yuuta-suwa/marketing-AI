import type { ComplianceProfile } from "@/domain/compliance/compliance";
import type { ConnectorContext, ConnectorHealth, MarketConnector } from "@/domain/connector/connector";
import type { CostEstimate } from "@/domain/cost/cost";
import type { ResearchDirective } from "@/domain/research/directive";
import type { RawSourceItem } from "@/domain/source/source-item";
import { buildQuery, fetchJson, isoOrUndefined, processEnv, type EnvReader, type FetchLike } from "./http";

type PlacesResponse = {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    googleMapsUri?: string;
    reviews?: Array<{
      name: string;
      text?: { text: string; languageCode?: string };
      rating?: number;
      publishTime?: string;
    }>;
  }>;
};

/**
 * Google Places API (New) Text Search with reviews field.
 * PENDING_REVIEW: Google Maps Platform terms restrict caching/storing
 * content (except place IDs) and require attribution. Storage of review
 * text for analysis needs legal review before this can be APPROVED.
 */
export class GooglePlacesConnector implements MarketConnector {
  readonly id = "google_places";
  readonly name = "Google Places API";
  readonly category = "TRAVEL" as const;
  readonly description = "Places API (New) で施設とレビューを取得（保存条件の法務レビュー待ち）";
  readonly env = [{ name: "GOOGLE_PLACES_API_KEY", description: "Google Maps Platform API key (server-side)", secret: true }] as const;
  readonly sourceQuality = 0.55;
  readonly enabledByDefault = false;
  readonly credentialsRequired = true;
  static readonly COST_PER_REQUEST_USD = 0.04;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly env_: EnvReader = processEnv,
  ) {}

  credentialsPresent(): boolean {
    return Boolean(this.env_("GOOGLE_PLACES_API_KEY"));
  }

  async search(directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
    const key = this.env_("GOOGLE_PLACES_API_KEY");
    if (!key) return [];
    const data = await fetchJson<PlacesResponse>(this.id, this.fetchImpl, "https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.googleMapsUri,places.reviews",
      },
      body: JSON.stringify({
        textQuery: buildQuery(directive.keywords, directive.objective, 4),
        languageCode: directive.languages[0] ?? "ja",
        pageSize: 5,
      }),
      signal: context.signal,
    });
    const items: RawSourceItem[] = [];
    for (const place of data.places ?? []) {
      for (const review of place.reviews ?? []) {
        if (!review.text?.text) continue;
        items.push({
          sourceType: "REVIEW",
          sourceName: `Google Maps / ${place.displayName?.text ?? place.id}`,
          sourceUrl: place.googleMapsUri,
          externalId: review.name,
          body: review.text.text,
          language: review.text.languageCode,
          publishedAt: isoOrUndefined(review.publishTime),
          engagement: { rating: review.rating },
          metadata: { provider: "google-places", placeId: place.id, attributionRequired: true },
        });
      }
    }
    return items.slice(0, context.limit);
  }

  async healthCheck(): Promise<ConnectorHealth> {
    const checkedAt = new Date().toISOString();
    if (!this.credentialsPresent()) return { status: "NOT_CONFIGURED", message: "GOOGLE_PLACES_API_KEY 未設定", checkedAt };
    return { status: "HEALTHY", checkedAt };
  }

  complianceStatus(): ComplianceProfile {
    return {
      status: "PENDING_REVIEW",
      accessMethod: "OFFICIAL_API",
      termsUrl: "https://cloud.google.com/maps-platform/terms",
      notes: "Maps Platform規約はplace ID以外のコンテンツのキャッシュ/保存を制限。レビュー本文の保存・分析可否を法務確認するまで実行しない。",
      prohibitions: ["Google Mapsのスクレイピング", "規約で許可されない期間を超えたコンテンツ保存", "帰属表示の削除"],
    };
  }

  async estimateCost(): Promise<CostEstimate> {
    return { amountUsd: GooglePlacesConnector.COST_PER_REQUEST_USD, basis: "1 Text Search (Pro/Enterprise fields)" };
  }
}
