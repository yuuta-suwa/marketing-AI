import { listConnectorStatus } from "@/application/queries";
import { Tag } from "@/components/badges";
import { ConnectorSettingForm } from "@/components/forms/connector-setting-form";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { SettingsNav } from "../nav";

export const metadata = { title: "Connectors" };

const COMPLIANCE_TONE: Record<string, string> = {
  APPROVED: "text-emerald-600",
  PENDING_REVIEW: "text-amber-600",
  RESTRICTED: "text-amber-600",
  DISABLED_PENDING_COMPLIANCE: "text-zinc-500",
  DISABLED: "text-red-600",
};

const MODE_TONE: Record<string, string> = {
  LIVE: "bg-emerald-600 text-white",
  MOCK: "bg-fuchsia-600 text-white",
  DISABLED: "bg-zinc-500 text-white",
};

const READINESS_LABEL: Record<string, string> = {
  LIVE_READY: "ライブ疎通OK",
  CONFIGURED_UNTESTED: "設定済み（疎通確認: npm run smoke:live）",
  READY_NEEDS_CREDENTIALS: "READY_NEEDS_CREDENTIALS — 認証情報が必要",
  PENDING_COMPLIANCE: "規約・許諾の確認待ち",
  NOT_IMPLEMENTED: "未実装（許可されたアクセス手段なし）",
  MOCK: "MOCK（合成データ）",
  FAILED: "疎通失敗",
  NO_CREDENTIALS_REQUIRED: "認証不要（ユーザー提供データ）",
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—");

export default async function ConnectorsPage() {
  const connectors = await listConnectorStatus(await pageContext());
  return (
    <>
      <PageHeader title="Connectors" subtitle="公式API優先。規約・許諾が確認できないConnectorは実行されません。認証情報はサーバー環境変数のみで管理します。" />
      <SettingsNav />
      <ul className="space-y-3" data-testid="connector-list">
        {connectors.map((c) => (
          <li key={c.id}>
            <Card>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-muted">{c.description}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${MODE_TONE[c.mode]}`} data-testid="connector-mode" data-mode={c.mode}>{c.mode}</span>
                  <Tag>{c.category}</Tag>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">Readiness</dt><dd data-testid="connector-readiness">{READINESS_LABEL[c.readiness] ?? c.readiness}</dd>
                <dt className="text-muted">Compliance</dt><dd className={`font-semibold ${COMPLIANCE_TONE[c.compliance]}`}>{c.compliance}</dd>
                <dt className="text-muted">Credentials</dt><dd>{!c.credentialsRequired ? "不要" : c.mode === "MOCK" ? "MOCK（実キー未使用）" : c.credentialsPresent ? "設定済み" : "未設定"}</dd>
                <dt className="text-muted">Health</dt><dd>{c.health.status}{c.health.message ? ` (${c.health.message})` : ""}</dd>
                <dt className="text-muted">実行</dt><dd className={c.runnable ? "text-emerald-600" : "text-muted"}>{c.runnable ? "実行可能" : c.blockedReason}</dd>
                <dt className="text-muted">最終成功</dt><dd>{fmt(c.lastSuccessAt)}</dd>
                <dt className="text-muted">最終エラー</dt><dd className="[overflow-wrap:anywhere]">{c.lastError ? `${fmt(c.lastError.at)} ${c.lastError.message}` : "—"}</dd>
                <dt className="text-muted">本日のリクエスト</dt><dd>{c.requestsToday}</dd>
                <dt className="text-muted">本日の推定コスト</dt><dd>${c.costTodayUsd.toFixed(4)}</dd>
              </dl>
              {c.missingEnv.length > 0 ? (
                <p className="mt-2 text-[11px]" data-testid="missing-env">
                  必要な環境変数: {c.missingEnv.map((n) => <code key={n} className="mr-1 break-all font-mono">{n}</code>)}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted">{c.profile.notes}</p>
              {c.env.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
                  {c.env.map((e) => <li key={e.name}><code className="break-all font-mono">{e.name}</code>{e.secret ? " (secret)" : ""} — {e.description}</li>)}
                </ul>
              ) : null}
              {c.profile.termsUrl ? <a href={c.profile.termsUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] underline">利用規約</a> : null}
              {c.termsNotes ? <p className="mt-1 text-[11px]">組織メモ: {c.termsNotes}</p> : null}
              {c.canConfigure && c.id !== "manual_import" ? (
                <ConnectorSettingForm connectorKey={c.id} enabled={c.enabled} compliance={c.compliance} allowedStatuses={c.allowedStatuses} termsNotes={c.termsNotes} />
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
