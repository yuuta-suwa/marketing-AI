import Link from "next/link";
import { getCostSummary } from "@/application/queries";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { pageContext } from "@/lib/page-context";
import { SettingsNav } from "../nav";

export const metadata = { title: "Costs" };

export default async function CostsPage() {
  const c = await getCostSummary(await pageContext());
  return (
    <>
      <PageHeader title="Costs" subtitle="予算超過時はオプションのAI処理を停止し、収集済みデータは保持します。" />
      <SettingsNav />
      <div className="grid grid-cols-3 gap-2">
        <Budget label="本日" spent={c.daily} limit={c.budget.dailyUsd} />
        <Budget label="今月" spent={c.monthly} limit={c.budget.monthlyUsd} />
        <Card><p className="text-[11px] text-muted">1調査上限</p><p className="font-bold">${c.budget.perRunUsd.toFixed(2)}</p></Card>
      </div>
      <SectionTitle>Research Runs</SectionTitle>
      <ul className="space-y-1 text-sm">
        {c.runs.map((r) => (
          <li key={r.id} className="flex justify-between border-b border-line py-1.5"><Link className="underline" href={`/research/runs/${r.id}`}>{new Date(r.createdAt).toLocaleString("ja-JP")}</Link><span>${r.costUsd.toFixed(4)}</span></li>
        ))}
      </ul>
      <SectionTitle>Agent Runs</SectionTitle>
      <ul className="space-y-1 text-xs">
        {c.agentRuns.map((a) => (
          <li key={a.id} className="flex justify-between gap-2 border-b border-line py-1"><span className="font-mono">{a.agentName}</span><span className="text-muted">{a.status} · {a.model} · {a.tokenUsage.inputTokens + a.tokenUsage.outputTokens} tok · ${a.estimatedCost.toFixed(4)}</span></li>
        ))}
      </ul>
    </>
  );
}

function Budget({ label, spent, limit }: { label: string; spent: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  return (
    <Card>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="font-bold">${spent.toFixed(3)}</p>
      <div className="mt-1 h-1.5 rounded-full bg-line"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
      <p className="mt-1 text-[10px] text-muted">上限 ${limit.toFixed(2)}</p>
    </Card>
  );
}
