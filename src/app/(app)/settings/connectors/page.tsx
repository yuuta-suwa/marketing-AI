import { listConnectorStatus } from "@/application/queries";
import { Tag } from "@/components/badges";
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
                <Tag>{c.category}</Tag>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">Compliance</dt><dd className={`font-semibold ${COMPLIANCE_TONE[c.compliance]}`}>{c.compliance}</dd>
                <dt className="text-muted">Credentials</dt><dd>{!c.credentialsRequired ? "不要" : c.credentialsPresent ? "設定済み" : "未設定"}</dd>
                <dt className="text-muted">Health</dt><dd>{c.health.status}{c.health.message ? ` (${c.health.message})` : ""}</dd>
                <dt className="text-muted">実行</dt><dd className={c.runnable ? "text-emerald-600" : "text-muted"}>{c.runnable ? "実行可能" : c.blockedReason}</dd>
              </dl>
              <p className="mt-2 text-xs text-muted">{c.profile.notes}</p>
              {c.env.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
                  {c.env.map((e) => <li key={e.name}><code className="font-mono">{e.name}</code>{e.secret ? " (secret)" : ""} — {e.description}</li>)}
                </ul>
              ) : null}
              {c.profile.termsUrl ? <a href={c.profile.termsUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] underline">利用規約</a> : null}
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
