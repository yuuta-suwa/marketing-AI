import Link from "next/link";
import { getObservability } from "@/application/queries";
import { EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { SettingsNav } from "../nav";

export const metadata = { title: "Observability" };

export default async function ObservabilityPage() {
  const d = await getObservability(await pageContext());
  return (
    <>
      <PageHeader title="Observability" subtitle="Connector・Agentの実行ログ（構造化ログはサーバー標準出力にJSONで出力）" />
      <SettingsNav />
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
