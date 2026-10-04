import Link from "next/link";
import { getObservability, getWorkerHealthView } from "@/application/queries";
import { diagnoseCredentials } from "@/infrastructure/credentials";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { RequeueJobForm } from "@/components/forms/requeue-job-form";
import { JOB_STATUS_LABEL_JA, JOB_TYPE_LABEL_JA } from "@/domain/jobs/job";
import { SettingsNav } from "../nav";

export const metadata = { title: "Observability" };

const HEALTH_TONE: Record<string, string> = { HEALTHY: "text-emerald-600", DEGRADED: "text-amber-600", OFFLINE: "text-red-600" };
const CRED_TONE: Record<string, string> = { READY: "text-emerald-600", CONFIGURED: "text-emerald-600", MISSING: "text-red-600", INVALID: "text-red-600", EXPIRED: "text-red-600", RATE_LIMITED: "text-amber-600" };

export default async function ObservabilityPage() {
  const ctx = await pageContext();
  const d = await getObservability(ctx);
  // Platform/worker internals are admin-only; members never see them.
  const health = d.canManageJobs ? await getWorkerHealthView(ctx) : null;
  const webCredentials = d.canManageJobs ? diagnoseCredentials(process.env).filter((c) => c.group === "supabase" || c.group === "cron") : [];
  return (
    <>
      <PageHeader title="Observability" subtitle="Connector・Agentの実行ログ（構造化ログはサーバー標準出力にJSONで出力）" />
      <SettingsNav />
      {health ? (
        <>
          <SectionTitle>Worker Health（管理者のみ）</SectionTitle>
          <div className="rounded-xl border border-line bg-surface p-3 text-xs" data-testid="worker-health" data-status={health.status}>
            <p className={`text-sm font-bold ${HEALTH_TONE[health.status]}`}>{health.status}</p>
            {health.reasons.map((r) => <p key={r} className="text-muted">{r}</p>)}
            <p className="mt-1 text-muted">キュー待ち最古: {health.oldestQueuedSeconds === null ? "—" : `${health.oldestQueuedSeconds}秒`}</p>
            <ul className="mt-2 space-y-1">
              {health.workers.map((w) => (
                <li key={w.workerId} className="border-t border-line pt-1">
                  <span className="font-mono">{w.workerId}</span> · v{w.version} · {w.appEnv} · 起動 {new Date(w.startedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} · 最終HB {new Date(w.lastHeartbeatAt).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" })} · 処理 {w.jobsProcessed} / 失敗 {w.jobsFailed}{w.busy ? ` · 実行中: ${w.currentJobType ?? ""}` : ""}
                  {Object.keys(w.diagnostics ?? {}).length > 0 ? (
                    <p className="text-muted [overflow-wrap:anywhere]">
                      {Object.entries(w.diagnostics).map(([k, v]) => <span key={k} className={`mr-2 ${CRED_TONE[v] ?? ""}`}>{k}:{v}</span>)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {webCredentials.length > 0 ? (
              <p className="mt-2 text-muted [overflow-wrap:anywhere]" data-testid="web-credentials">
                Web: {webCredentials.map((c) => <span key={c.name} className={`mr-2 ${CRED_TONE[c.status] ?? ""}`}>{c.name}:{c.status}</span>)}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
      <SectionTitle hint={`${d.deadLetters.length}件`}>Dead Letters（失敗が確定したジョブ）</SectionTitle>
      {d.deadLetters.length === 0 ? <EmptyState>なし</EmptyState> : (
        <ul className="space-y-1 text-xs" data-testid="dead-letters">
          {d.deadLetters.map((j) => (
            <li key={j.id} className="border-b border-line py-1.5">
              <div className="flex justify-between gap-2">
                <span>{JOB_TYPE_LABEL_JA[j.jobType]}</span>
                <span className="text-red-600">試行 {j.attemptCount}/{j.maxAttempts}</span>
              </div>
              <p className="text-muted [overflow-wrap:anywhere]">{j.lastError ?? ""}</p>
              {j.researchRunId ? <Link className="underline" href={`/research/runs/${j.researchRunId}`}>run</Link> : null}
              {d.canManageJobs ? <RequeueJobForm jobId={j.id} /> : null}
            </li>
          ))}
        </ul>
      )}
      <SectionTitle>Background Jobs</SectionTitle>
      {d.jobs.length === 0 ? <EmptyState>ジョブなし</EmptyState> : (
        <ul className="space-y-1 text-xs" data-testid="job-list">
          {d.jobs.map((j) => (
            <li key={j.id} className="flex justify-between gap-2 border-b border-line py-1.5">
              <span>{JOB_TYPE_LABEL_JA[j.jobType]}</span>
              <span className={j.status === "FAILED" ? "text-red-600" : "text-muted"}>{JOB_STATUS_LABEL_JA[j.status]} · 試行 {j.attemptCount}/{j.maxAttempts}</span>
            </li>
          ))}
        </ul>
      )}
      <SectionTitle>Connector Runs</SectionTitle>
      {d.connectorRuns.length === 0 ? <EmptyState>実行履歴なし</EmptyState> : (
        <ul className="space-y-1 text-xs">
          {d.connectorRuns.map((c, i) => (
            <li key={i} className="border-b border-line py-1.5">
              <div className="flex justify-between gap-2">
                <span className="font-mono">{c.connectorKey}</span>
                <span className={c.status === "FAILED" ? "text-red-600" : "text-muted"}>{c.status} · {c.resultCount}件 · {c.durationMs}ms · retry {c.retryCount} · ${(c.costUsd ?? 0).toFixed(4)}</span>
              </div>
              <div className="flex justify-between gap-2 text-muted">
                <Link className="underline" href={`/research/runs/${c.researchRunId}`}>run</Link>
                <span className="truncate">{c.error ?? ""}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <SectionTitle>Agent Runs</SectionTitle>
      {d.agentRuns.length === 0 ? <EmptyState>実行履歴なし</EmptyState> : (
        <ul className="space-y-1 text-xs">
          {d.agentRuns.map((a) => (
            <li key={a.id} className="flex justify-between gap-2 border-b border-line py-1.5">
              <span className="font-mono">{a.agentName}</span>
              <span className={a.status === "FAILED" ? "text-red-600" : "text-muted"}>{a.status} · {a.provider}/{a.model} · {a.durationMs ?? 0}ms · {a.tokenUsage.inputTokens + a.tokenUsage.outputTokens} tok · ${a.estimatedCost.toFixed(4)}{a.error ? ` · ${a.error.slice(0, 80)}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
