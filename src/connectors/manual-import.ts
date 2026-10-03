import type { ComplianceProfile } from "@/domain/compliance/compliance";
import type { ConnectorContext, ConnectorHealth, MarketConnector } from "@/domain/connector/connector";
import type { ResearchDirective } from "@/domain/research/directive";
import type { CostEstimate } from "@/domain/cost/cost";
import { RawSourceItemSchema, type RawSourceItem } from "@/domain/source/source-item";
import { fetchPageForImport, UrlImportError } from "./url-import";

export type PageImporter = (url: string) => Promise<{ url: string; title?: string; text: string }>;

/**
 * User-supplied material (interview notes, survey answers, exported reviews
 * the user is entitled to use). Always available; no external calls.
 */
export class ManualImportConnector implements MarketConnector {
  readonly id = "manual_import";
  readonly name = "Manual Import";
  readonly category = "MANUAL" as const;
  readonly description = "ユーザーが権利を持つテキスト・CSV・URL（単一ページ、robots.txt順守）を取り込む";
  readonly env = [] as const;
  readonly sourceQuality = 0.6;
  readonly enabledByDefault = true;
  readonly credentialsRequired = false;

  constructor(private readonly importPage: PageImporter = (url) => fetchPageForImport(url)) {}

  async search(_directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
    const items: RawSourceItem[] = (context.manualItems ?? []).map((item) =>
      RawSourceItemSchema.parse({
        ...item,
        sourceType: item.sourceType || "MANUAL",
        sourceName: item.sourceName || "Manual Import",
      }),
    );
    for (const url of context.manualUrls ?? []) {
      try {
        const page = await this.importPage(url);
        items.push({
          sourceType: "WEB",
          sourceName: `${new URL(page.url).hostname} (URL import)`,
          sourceUrl: page.url,
          title: page.title,
          body: page.text,
          metadata: { importedBy: "user", method: "url" },
        });
      } catch (e) {
        context.warn?.(`URL取込失敗 ${url}: ${e instanceof UrlImportError ? e.message : "取得エラー"}`);
      }
    }
    return items.slice(0, context.limit);
  }

  async estimateCost(): Promise<CostEstimate> {
    return { amountUsd: 0, basis: "no external API" };
  }

  async healthCheck(): Promise<ConnectorHealth> {
    return { status: "HEALTHY", checkedAt: new Date().toISOString() };
  }

  complianceStatus(): ComplianceProfile {
    return {
      status: "APPROVED",
      accessMethod: "USER_UPLOAD",
      notes: "ユーザーが利用権限を持つデータのみ取り込むこと（アップロード時に確認）。",
      prohibitions: ["第三者サイトから規約に反して取得したデータの取り込み"],
    };
  }

  credentialsPresent(): boolean {
    return true;
  }
}
