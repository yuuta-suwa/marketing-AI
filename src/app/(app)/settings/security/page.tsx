import { Card, PageHeader } from "@/components/ui";
import { providerStatuses } from "@/infrastructure/ai/provider-factory";
import { pageContext } from "@/lib/page-context";
import { SettingsNav } from "../nav";

export const metadata = { title: "Security" };

export default async function SecurityPage() {
  const ctx = await pageContext();
  return (
    <>
      <PageHeader title="Security" />
      <SettingsNav />
      <Card>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted">ユーザー</dt><dd className="font-mono text-xs">{ctx.actor.userId}</dd>
          <dt className="text-muted">組織</dt><dd className="font-mono text-xs">{ctx.actor.organizationId}</dd>
          <dt className="text-muted">ロール</dt><dd>{ctx.actor.role}</dd>
        </dl>
      </Card>
      <Card className="mt-3">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>全テーブルでRow Level Security（組織単位の分離）</li>
          <li>権限はorganization_membersのロールで判定（user_metadataは不使用）</li>
          <li>APIキーはサーバー環境変数のみ。ブラウザへ送信しません</li>
          <li>重要操作はaudit_logsへ記録（管理者のみ閲覧可）</li>
          <li>人間の判断（decisions）は本人にのみ帰属</li>
        </ul>
      </Card>
      <Card className="mt-3">
        <p className="mb-2 text-sm font-semibold">AI Providers</p>
        <ul className="space-y-1 text-xs">
          {providerStatuses().map((p) => (
            <li key={p.id} className="flex justify-between gap-2"><span>{p.id}</span><span className="text-muted">{p.implemented ? (p.configured ? "設定済み" : "未設定") : "未実装"} · {p.note}</span></li>
          ))}
        </ul>
      </Card>
    </>
  );
}
