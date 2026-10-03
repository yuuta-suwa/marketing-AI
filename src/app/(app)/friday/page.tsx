import Link from "next/link";
import { getFridayCenter } from "@/application/queries";
import { ConfidenceBadge, OpportunityStatusPill, RunStatusPill, ScoreBadge } from "@/components/badges";
import { FridayConsole } from "@/components/friday/console";
import { CouncilView } from "@/components/friday/council-view";
import { CouncilButton, PocButtons } from "@/components/forms/executive-forms";
import { DecisionPanel } from "@/components/forms/opportunity-actions";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { allowedNextStatuses } from "@/domain/opportunity/status";
import { RUN_TYPE_LABEL_JA } from "@/domain/research/run";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "FRIDAY" };

export default async function FridayPage({ searchParams }: PageProps<"/friday">) {
  const sp = await searchParams;
  const opportunityId = typeof sp.opportunity === "string" ? sp.opportunity : undefined;
  const d = await getFridayCenter(await pageContext(), opportunityId);
  const o = d.selected;
  return (
    <>
      <PageHeader title="FRIDAY Command Center" subtitle="Executive Interface — 指示・相談・顧問会議・判断。会話は保存せず、判断のみ記録します。最終判断は人間です。" />

      <SectionTitle>Current Context</SectionTitle>
      <Card>
        <form method="get" className="flex gap-2">
          <select name="opportunity" defaultValue={o?.id ?? ""} className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-sm" aria-label="対象の事業機会">
            <option value="">（事業機会を選択）</option>
            {d.opportunities.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
          <button className="min-h-11 rounded-xl border border-line px-3 text-sm">切替</button>
        </form>
      </Card>

      <SectionTitle>Conversation</SectionTitle>
      <Card><FridayConsole opportunityId={o?.id} /></Card>

      <SectionTitle>Related Opportunity</SectionTitle>
      {o ? (
        <Card>
          <div className="flex items-start justify-between gap-2">
            <Link href={`/opportunities/${o.id}`} className="font-semibold underline">{o.title}</Link>
            <ScoreBadge score={o.scoreTotal} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5"><ConfidenceBadge level={o.confidence} /><OpportunityStatusPill status={o.status} /></div>
          <p className="mt-2 text-sm">{o.pain}</p>
          {o.mainRisk ? <p className="mt-1 text-xs text-muted">主なリスク: {o.mainRisk}</p> : null}
        </Card>
      ) : <EmptyState>Current Contextで事業機会を選ぶと、FRIDAYがその文脈で動きます。</EmptyState>}

      <SectionTitle>Pending Decisions</SectionTitle>
      {d.pendingDecisions.length === 0 ? <EmptyState>CEO判断待ちはありません</EmptyState> : (
        <ul className="space-y-1.5 text-sm">{d.pendingDecisions.map((p) => <li key={p.id}><Link className="underline" href={`/friday?opportunity=${p.id}`}>{p.title}</Link> <OpportunityStatusPill status={p.status} /></li>)}</ul>
      )}

      <SectionTitle>Research Status</SectionTitle>
      {d.recentRuns.length === 0 ? <EmptyState>調査なし</EmptyState> : (
        <ul className="space-y-1.5">
          {d.recentRuns.map((r) => (
            <li key={r.id}><Link href={`/research/runs/${r.id}`} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-sm">{RUN_TYPE_LABEL_JA[r.runType]} <RunStatusPill status={r.status} /></Link></li>
          ))}
        </ul>
      )}

      <div id="council" />
      <SectionTitle>Advisor Council</SectionTitle>
      {o ? (
        <Card>
          {d.council ? <CouncilView session={d.council} /> : <p className="mb-2 text-sm text-muted">まだ開催していません。</p>}
          <div className="mt-3"><CouncilButton opportunityId={o.id} /></div>
        </Card>
      ) : <EmptyState>事業機会を選択してください</EmptyState>}

      <SectionTitle>Actions</SectionTitle>
      {o ? (
        <Card>
          <PocButtons opportunityId={o.id} exportAllowed={o.status === "POC_APPROVED" || o.status === "LAUNCHED"} />
          <div className="mt-3"><DecisionPanel opportunityId={o.id} status={o.status} nextStatuses={allowedNextStatuses(o.status)} /></div>
          {!d.canCeoApprove ? <p className="mt-2 text-xs text-muted">PoC承認・ローンチは管理者（CEO）のみ実行できます。</p> : null}
        </Card>
      ) : <EmptyState>事業機会を選択してください</EmptyState>}

      <SectionTitle>Decision Memory</SectionTitle>
      {d.decisions.length === 0 ? <EmptyState>記録された判断はありません</EmptyState> : (
        <ul className="space-y-1 text-xs" data-testid="decision-memory">
          {d.decisions.map((x) => (
            <li key={x.id} className="border-b border-line py-1">
              {new Date(x.createdAt).toLocaleString("ja-JP")} · <b>{x.subject ?? x.decision}</b> · {x.decision} · {x.fromStatus} → {x.toStatus ?? "—"} · {x.source}{x.rationale ? ` · 理由: ${x.rationale}` : ""}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
