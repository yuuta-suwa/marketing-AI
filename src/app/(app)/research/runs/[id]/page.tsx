import Link from "next/link";
import { getRunDetail } from "@/application/queries";
import { ConfidenceBadge, RunStatusPill, Tag } from "@/components/badges";
import { OpportunityCard } from "@/components/opportunity-card";
import { RunPoller } from "@/components/run-poller";
import { Card, EmptyState, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { RUN_TYPE_LABEL_JA } from "@/domain/research/run";
import { RESEARCH_RUN_STATUSES, isTerminalRunStatus } from "@/domain/research/run-state-machine";
import { orNotFound, pageContext } from "@/lib/page-context";

export const metadata = { title: "調査結果" };

const PIPELINE = RESEARCH_RUN_STATUSES.slice(1, 8);

export default async function RunDetailPage({ params }: PageProps<"/research/runs/[id]">) {
  const { id } = await params;
  const ctx = await pageContext();
  const d = await orNotFound(getRunDetail(ctx, id));
  const active = !isTerminalRunStatus(d.run.status);
  const stepIndex = PIPELINE.indexOf(d.run.status as (typeof PIPELINE)[number]);

  return (
    <>
      <RunPoller active={active} />
      <PageHeader
        title={RUN_TYPE_LABEL_JA[d.run.runType]}
        subtitle={d.directive?.rawInput}
        action={<RunStatusPill status={d.run.status} />}
      />
      {active ? (
        <ol className="mb-4 grid grid-cols-7 gap-1" aria-label="進行状況">
          {PIPELINE.map((s, i) => (
            <li key={s} className={`h-1.5 rounded-full ${i <= stepIndex ? "bg-accent" : "bg-line"}`} title={s} />
          ))}
        </ol>
      ) : null}
      {d.run.statusReason ? <Notice tone={d.run.status === "FAILED" ? "error" : "warn"}>{d.run.statusReason}</Notice> : null}
      {d.run.opportunityId ? (
        <p className="mt-2 text-sm"><Link className="underline" href={`/opportunities/${d.run.opportunityId}`}>元の事業機会へ戻る</Link></p>
      ) : null}

      <SectionTitle>Summary</SectionTitle>
      <Card>
        <dl className="grid grid-cols-3 gap-3 text-center text-sm">
          <Stat k="Source" v={d.run.stats.sourceItems} />
          <Stat k="重複除外" v={d.run.stats.duplicates} />
          <Stat k="Evidence" v={d.evidenceCount} />
          <Stat k="Signal" v={d.run.stats.signals} />
          <Stat k="Cluster" v={d.run.stats.clusters} />
          <Stat k="Opportunity" v={d.run.stats.opportunities} />
        </dl>
        <p className="mt-3 text-xs text-muted">コスト ${d.run.costUsd.toFixed(4)} / 上限 ${d.run.budgetLimitUsd.toFixed(2)}</p>
      </Card>

      {d.directive ? (
        <>
          <SectionTitle>Research Directive</SectionTitle>
          <Card>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {d.directive.countries.map((c) => <Tag key={c}>{c}</Tag>)}
              {d.directive.languages.map((l) => <Tag key={l}>{l}</Tag>)}
              {d.directive.categories.map((c) => <Tag key={c}>{c}</Tag>)}
              {d.directive.personas.map((p) => <Tag key={p}>{p}</Tag>)}
            </div>
            <p className="mt-2 text-xs text-muted">Keywords: {d.directive.keywords.join(", ") || "—"} · 解析: {d.directive.parser}</p>
          </Card>
        </>
      ) : null}

      <SectionTitle>Connectors</SectionTitle>
      {d.connectorRuns.length === 0 ? <EmptyState>{active ? "収集中…" : "Connector実行なし"}</EmptyState> : (
        <ul className="space-y-1.5" data-testid="connector-runs">
          {d.connectorRuns.map((c) => (
            <li key={c.connectorKey} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{c.connectorKey}</span>
                <span className={c.status === "FAILED" ? "text-red-600" : c.status === "SKIPPED" ? "text-muted" : "text-emerald-600"}>{c.status} · {c.resultCount}件 · {c.durationMs}ms</span>
              </div>
              {c.error ? <p className="mt-1 text-xs text-muted">{c.error}</p> : null}
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Opportunities</SectionTitle>
      <div className="space-y-3">
        {d.opportunities.length === 0 ? <EmptyState>{active ? "分析中…" : "事業機会は生成されませんでした"}</EmptyState> : d.opportunities.map((o) => <OpportunityCard key={o.id} opportunity={o} />)}
      </div>

      <SectionTitle>Clusters</SectionTitle>
      {d.clusters.length === 0 ? <EmptyState>—</EmptyState> : (
        <ul className="space-y-2">
          {d.clusters.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{c.name}</span>
                <ConfidenceBadge level={c.confidence} />
              </div>
              <p className="mt-1 text-xs text-muted">{c.signalCount}シグナル · {c.sourceCount}ソース · 痛み{c.painScore} · 支払意思{c.paySignalScore}</p>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Agent Runs</SectionTitle>
      <ul className="space-y-1 text-xs">
        {d.agentRuns.map((a) => (
          <li key={a.id} className="flex justify-between gap-2 border-b border-line py-1">
            <span className="font-mono">{a.agentName}</span>
            <span className={a.status === "FAILED" ? "text-red-600" : "text-muted"}>{a.status} · {a.provider} · ${a.estimatedCost.toFixed(4)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Stat({ k, v }: { k: string; v?: number }) {
  return (
    <div>
      <dd className="text-lg font-bold">{v ?? 0}</dd>
      <dt className="text-[11px] text-muted">{k}</dt>
    </div>
  );
}
