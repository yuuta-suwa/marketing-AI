import Link from "next/link";
import { getRunDetail } from "@/application/queries";
import { ConfidenceBadge, RunStatusPill, Tag } from "@/components/badges";
import { OpportunityCard } from "@/components/opportunity-card";
import { RunProgress } from "@/components/run-progress";
import { CancelRunForm } from "@/components/forms/cancel-run-form";
import { QualityReviewForm } from "@/components/forms/quality-review-form";
import { Card, EmptyState, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { RUN_TYPE_LABEL_JA } from "@/domain/research/run";
import { SIGNAL_TYPE_LABEL_JA } from "@/domain/signal/signal";
import { isTerminalRunStatus } from "@/domain/research/run-state-machine";
import { JOB_STATUS_LABEL_JA, JOB_TYPE_LABEL_JA } from "@/domain/jobs/job";
import { runtimeMode } from "@/infrastructure/runtime-mode";
import { orNotFound, pageContext } from "@/lib/page-context";

export const metadata = { title: "調査結果" };

export default async function RunDetailPage({ params }: PageProps<"/research/runs/[id]">) {
  const { id } = await params;
  const ctx = await pageContext();
  const d = await orNotFound(getRunDetail(ctx, id));
  const active = !isTerminalRunStatus(d.run.status);
  const waitingForWorker = d.queueWaitSeconds !== null && d.queueWaitSeconds > 60;

  return (
    <>
      <PageHeader
        title={RUN_TYPE_LABEL_JA[d.run.runType]}
        subtitle={d.directive?.rawInput}
        action={<RunStatusPill status={d.run.status} />}
      />
      <RunProgress
        runId={d.run.id}
        realtime={runtimeMode() === "supabase"}
        initial={{ status: d.run.status, progressPercent: d.run.progressPercent, currentAction: d.run.currentAction }}
      />
      {active && d.canCancel ? <CancelRunForm runId={d.run.id} /> : null}
      {active && waitingForWorker ? (
        <Notice tone="warn">ジョブが{Math.round(d.queueWaitSeconds! / 60)}分以上待機しています。バックグラウンドワーカー（npm run worker）が稼働しているか確認してください。</Notice>
      ) : null}
      <p className="mb-3 text-sm"><span className="text-muted">Objective: </span>{d.directive?.objective ?? "—"}</p>
      {d.run.statusReason ? <Notice tone={d.run.status === "FAILED" ? "error" : "warn"}>{d.run.statusReason}</Notice> : null}
      {d.run.opportunityId ? (
        <p className="mt-2 text-sm"><Link className="underline" href={`/opportunities/${d.run.opportunityId}`}>元の事業機会へ戻る</Link></p>
      ) : null}

      <SectionTitle>Summary</SectionTitle>
      <Card>
        <dl className="grid grid-cols-3 gap-3 text-center text-sm">
          <Stat k="Items Collected" v={d.sourceItemCount} />
          <Stat k="重複除外" v={d.run.stats.duplicates} />
          <Stat k="Evidence" v={d.evidenceCount} />
          <Stat k="Signal" v={d.run.stats.signals} />
          <Stat k="Cluster" v={d.run.stats.clusters} />
          <Stat k="Opportunity" v={d.run.stats.opportunities} />
        </dl>
        <p className="mt-3 text-xs text-muted">Estimated Cost ${d.estimatedCostUsd.toFixed(4)} / 上限 ${d.run.budgetLimitUsd.toFixed(2)}</p>
        {d.runningAgents.length > 0 ? (
          <p className="mt-1 text-xs" data-testid="agents-running">Agents Running: {d.runningAgents.map((a) => a.agentName).join(", ")}</p>
        ) : null}
      </Card>

      {d.errors.length > 0 ? (
        <>
          <SectionTitle>Errors</SectionTitle>
          <ul className="space-y-1 text-xs text-red-700 dark:text-red-300" data-testid="run-errors">
            {d.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </>
      ) : null}

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

      {d.jobs.length > 0 ? (
        <>
          <SectionTitle>Background Jobs</SectionTitle>
          <ul className="space-y-1.5" data-testid="run-jobs">
            {d.jobs.map((j) => (
              <li key={j.id} className="rounded-xl border border-line bg-surface px-3 py-2 text-xs" data-job-status={j.status}>
                <div className="flex items-center justify-between gap-2">
                  <span>{JOB_TYPE_LABEL_JA[j.jobType]}</span>
                  <span className={j.status === "FAILED" ? "text-red-600" : j.status === "COMPLETED" ? "text-emerald-600" : "text-muted"}>
                    {JOB_STATUS_LABEL_JA[j.status]} · 試行 {j.attemptCount}/{j.maxAttempts}
                  </span>
                </div>
                {j.lastError ? <p className="mt-1 text-muted [overflow-wrap:anywhere]">{j.lastError}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {d.run.stats.limitStops?.length ? (
        <>
          <SectionTitle>省略した処理（上限）</SectionTitle>
          <ul className="list-disc space-y-1 pl-5 text-xs" data-testid="limit-stops">
            {d.run.stats.limitStops.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </>
      ) : null}

      <SectionTitle>Connectors</SectionTitle>
      {d.connectorRuns.length === 0 ? <EmptyState>{active ? "収集中…" : "Connector実行なし"}</EmptyState> : (
        <ul className="space-y-1.5" data-testid="connector-runs">
          {d.connectorRuns.map((c) => (
            <li key={c.connectorKey} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{c.connectorKey}</span>
                <span className={c.status === "FAILED" ? "text-red-600" : c.status === "SKIPPED" ? "text-muted" : "text-emerald-600"}>{c.status} · {c.resultCount}件 · {c.durationMs}ms{c.retryCount ? ` · retry ${c.retryCount}` : ""}{c.costUsd ? ` · $${c.costUsd.toFixed(4)}` : ""}</span>
              </div>
              {c.error ? <p className="mt-1 text-xs text-muted">{c.error}</p> : null}
            </li>
          ))}
        </ul>
      )}

      <SectionTitle hint={`${d.signals.length}件`}>Market Signals</SectionTitle>
      {d.signals.length === 0 ? <EmptyState>{active ? "抽出中…" : "シグナルなし"}</EmptyState> : (
        <ul className="space-y-2" data-testid="signal-list">
          {d.signals.slice(0, 30).map((s) => (
            <li key={s.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Tag>{SIGNAL_TYPE_LABEL_JA[s.signalType]}</Tag>
                <ConfidenceBadge level={s.confidence} />
                <span className="text-[11px] text-muted">緊急度 {s.urgencyScore} · 頻度 {s.frequencySignal} · 支払意思 {s.willingnessToPayScore} · 乗換 {s.switchingIntentScore}</span>
              </div>
              <p className="mt-1">{s.problem}</p>
              <p className="mt-1 text-[11px] text-muted">
                {s.trustIssue ? "信頼 " : ""}{s.priceIssue ? "価格 " : ""}{s.accessIssue ? "アクセス " : ""}Evidence {s.evidenceIds.length} · {s.extractedBy}
                {s.fieldProvenance?.problem ? ` · problem=${s.fieldProvenance.problem}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle hint={`${d.sourceItemCount}件`}>Sources</SectionTitle>
      {d.sourceItems.length === 0 ? <EmptyState>{active ? "収集中…" : "ソースなし"}</EmptyState> : (
        <ul className="space-y-1.5" data-testid="source-list">
          {d.sourceItems.map((s) => (
            <li key={s.id} className="rounded-xl border border-line bg-surface px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{s.title ?? s.sourceName}</span>
                {s.metadata?.synthetic ? <Tag>MOCK</Tag> : <Tag>{s.sourceType}</Tag>}
              </div>
              <p className="mt-0.5 line-clamp-2 text-muted">{s.body}</p>
              <p className="mt-0.5 text-muted">
                {s.sourceName} · {s.language ?? "?"}/{s.country ?? "?"}
                {s.publishedAt ? ` · ${new Date(s.publishedAt).toLocaleDateString("ja-JP")}` : ""}
                {s.sourceUrl ? <> · <a className="underline" href={s.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">link</a></> : null}
              </p>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Opportunities</SectionTitle>
      <div className="space-y-3">
        {d.opportunities.length === 0 ? <EmptyState>{active ? "分析中…" : "事業機会は生成されませんでした"}</EmptyState> : d.opportunities.map((o) => <OpportunityCard key={o.id} opportunity={o} />)}
      </div>

      {!active && d.canReview && (d.opportunities.length > 0 || d.signals.length > 0) ? (
        <>
          <SectionTitle hint="人間のみが入力">Quality review</SectionTitle>
          <div className="space-y-2" data-testid="quality-review">
            {d.opportunities.map((o) => {
              const r = d.myReviews.get(o.id);
              return (
                <div key={o.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
                  <p className="font-semibold">{o.title}</p>
                  <QualityReviewForm researchRunId={d.run.id} entityType="OPPORTUNITY" entityId={o.id} rating={r?.rating ?? null} decision={r?.decision ?? "NONE"} useful={null} />
                </div>
              );
            })}
            {d.signals.slice(0, 20).map((s) => {
              const r = d.myReviews.get(s.id);
              return (
                <div key={s.id} className="rounded-xl border border-line bg-surface p-3 text-xs">
                  <p>{s.problem}</p>
                  <QualityReviewForm researchRunId={d.run.id} entityType="SIGNAL" entityId={s.id} rating={null} decision="NONE" useful={r?.useful ?? null} />
                </div>
              );
            })}
          </div>
        </>
      ) : null}

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
