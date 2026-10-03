import type { ComplianceProfile } from "@/domain/compliance/compliance";
import type { ConnectorContext, ConnectorHealth, MarketConnector } from "@/domain/connector/connector";
import type { ResearchDirective } from "@/domain/research/directive";
import { RawSourceItemSchema, type RawSourceItem } from "@/domain/source/source-item";

/**
 * User-supplied material (interview notes, survey answers, exported reviews
 * the user is entitled to use). Always available; no external calls.
 */
export class ManualImportConnector implements MarketConnector {
  readonly id = "manual_import";
  readonly name = "Manual Import";
  readonly category = "MANUAL" as const;
  readonly description = "ユーザーが権利を持つテキスト（インタビュー記録、アンケート、問い合わせ等）を取り込む";
  readonly env = [] as const;
  readonly sourceQuality = 0.6;
  readonly enabledByDefault = true;
  readonly credentialsRequired = false;

  async search(_directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]> {
    const items = context.manualItems ?? [];
    return items.slice(0, context.limit).map((item) =>
      RawSourceItemSchema.parse({
        ...item,
        sourceType: item.sourceType || "MANUAL",
        sourceName: item.sourceName || "Manual Import",
      }),
    );
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
