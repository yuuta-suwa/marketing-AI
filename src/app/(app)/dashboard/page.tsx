import Link from "next/link";
import { getDashboard } from "@/application/queries";
import { RunStatusPill, Tag } from "@/components/badges";
import { OpportunityCard } from "@/components/opportunity-card";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { RUN_TYPE_LABEL_JA } from "@/domain/research/run";
import { SIGNAL_TYPE_LABEL_JA } from "@/domain/signal/signal";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "ダッシュボード" };

export default async function DashboardPage() {
  const d = await getDashboard(await pageContext());
  return (
    <>
      <PageHeader title="Market Radar" subtitle="今日の市場シグナルと事業機会" />

      <Card className="border-accent/40">
        <p className="text-xs font-semibold text-accent">FRIDAY COMMAND</p>
        <form action="/research/new" method="get" className="mt-2 flex gap-2">
          <input name="q" placeholder="例: 日本の旅行市場の不満から新規事業を探して" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm" />
          <button className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-white">調査</button>
        </form>
      </Card>

      <SectionTitle hint={<Link href="/opportunities">すべて</Link>}>Top Opportunities</SectionTitle>
      <div className="space-y-3">
        {d.topOpportunities.length === 0 ? <EmptyState>まだ事業機会はありません。調査を開始してください。</EmptyState> : d.topOpportunities.map((o) => <OpportunityCard key={o.id} opportunity={o} />)}
      </div>

      <SectionTitle>Pending Decisions</SectionTitle>
      {d.pendingDecisions.length === 0 ? (
        <EmptyState>承認待ちはありません</EmptyState>
      ) : (
        <ul className="space-y-2">{d.pendingDecisions.map((o) => <li key={o.id}><Link className="text-sm underline" href={`/opportunities/${o.id}`}>{o.title}</Link></li>)}</ul>
      )}

      <SectionTitle>Fast Rising Pains</SectionTitle>
      {d.fastRising.length === 0 ? <EmptyState>モメンタムを判定できる日付付きデータがまだありません</EmptyState> : (
        <ul className="space-y-2 text-sm">{d.fastRising.map((o) => <li key={o.id}>▲{o.momentum} <Link className="underline" href={`/opportunities/${o.id}`}>{o.title}</Link></li>)}</ul>
      )}

      <SectionTitle hint={<Link href="/signals">すべて</Link>}>Today&apos;s Market Signals</SectionTitle>
      <SignalList signals={d.todaySignals} empty="直近24時間のシグナルはありません" />

      <SectionTitle>Pay Signals</SectionTitle>
      <SignalList signals={d.paySignals} empty="支払意思シグナルは未検出" />

      <SectionTitle>Watchlist Alerts</SectionTitle>
      <EmptyState>Watchlist監視は Milestone 3 で提供予定</EmptyState>

      <SectionTitle hint={<Link href="/research/runs">すべて</Link>}>Recent Research</SectionTitle>
      {d.recentRuns.length === 0 ? <EmptyState>調査履歴はありません</EmptyState> : (
        <ul className="space-y-2">
          {d.recentRuns.map((r) => (
            <li key={r.id}>
              <Link href={`/research/runs/${r.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                <span className="truncate">{RUN_TYPE_LABEL_JA[r.runType]} · {new Date(r.createdAt).toLocaleString("ja-JP")}</span>
                <RunStatusPill status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle hint={<Link href="/settings/costs">詳細</Link>}>Cost</SectionTitle>
      <Card><p className="text-sm">今月 ${d.monthSpend.toFixed(4)} / 上限 ${d.budget.monthlyUsd.toFixed(2)}</p></Card>
    </>
  );
}

function SignalList({ signals, empty }: { signals: Array<{ id: string; problem: string; signalType: keyof typeof SIGNAL_TYPE_LABEL_JA }>; empty: string }) {
  if (signals.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <ul className="space-y-2">
      {signals.map((s) => (
        <li key={s.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
          <Tag>{SIGNAL_TYPE_LABEL_JA[s.signalType]}</Tag>
          <p className="mt-1 line-clamp-2">{s.problem}</p>
        </li>
      ))}
    </ul>
  );
}
