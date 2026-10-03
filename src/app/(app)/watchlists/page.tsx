import Link from "next/link";
import { getWatchCenter } from "@/application/queries";
import { markReadAction } from "@/app/actions/executive";
import { Tag } from "@/components/badges";
import { CheckNowButton, WatchForm } from "@/components/forms/executive-forms";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "Watchlists" };

export default async function WatchlistsPage() {
  const d = await getWatchCenter(await pageContext());
  return (
    <>
      <PageHeader title="Watchlists" subtitle="Opportunity / Competitor / Problem / Market / Country / Keyword を定期監視。意味のある変化だけ通知します。" />
      <Card><WatchForm opportunities={d.opportunities.map((o) => ({ id: o.id, title: o.title }))} /></Card>
      <div className="mt-2"><CheckNowButton /></div>

      <SectionTitle hint={`${d.watchlists.length}件`}>Watching</SectionTitle>
      {d.watchlists.length === 0 ? <EmptyState>ウォッチ中の対象はありません</EmptyState> : (
        <ul className="space-y-1.5 text-sm" data-testid="watchlist">
          {d.watchlists.map((w) => (
            <li key={w.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{w.label ?? w.query}</span><Tag>{w.targetType}</Tag></div>
              <p className="text-[11px] text-muted">最終チェック: {w.lastCheckedAt ? new Date(w.lastCheckedAt).toLocaleString("ja-JP") : "未実行（初回は基準値の記録のみ）"} · スケジュール {w.scheduleCron ?? "—"}</p>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Notifications</SectionTitle>
      {d.notifications.length === 0 ? <EmptyState>通知はありません</EmptyState> : (
        <ul className="space-y-1.5 text-sm" data-testid="notifications">
          {d.notifications.map((n) => (
            <li key={n.id} className={`rounded-xl border p-3 ${n.readAt ? "border-line opacity-70" : "border-accent"}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{n.title}</span><Tag>{n.severity}</Tag></div>
              {n.body ? <p className="text-xs">{n.body}</p> : null}
              <div className="mt-1 flex items-center justify-between text-xs">
                {n.link ? <Link className="underline" href={n.link}>開く</Link> : <span />}
                {!n.readAt ? (
                  <form action={markReadAction}><input type="hidden" name="notificationId" value={n.id} /><button className="text-muted underline">既読</button></form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
