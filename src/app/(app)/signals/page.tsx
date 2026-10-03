import { ConfidenceBadge, Tag } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/ui";
import { SIGNAL_TYPE_LABEL_JA } from "@/domain/signal/signal";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "Signals" };

export default async function SignalsPage() {
  const ctx = await pageContext();
  const signals = await ctx.repos.signals.listSignals({ limit: 200 });
  return (
    <>
      <PageHeader title="Market Signals" subtitle={`${signals.length}件（最新200件）`} />
      {signals.length === 0 ? <EmptyState>シグナルはまだありません</EmptyState> : (
        <ul className="space-y-2">
          {signals.map((s) => (
            <li key={s.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5"><Tag>{SIGNAL_TYPE_LABEL_JA[s.signalType]}</Tag><ConfidenceBadge level={s.confidence} /><span className="text-xs text-muted">緊急度 {s.urgencyScore} · 支払意思 {s.willingnessToPayScore}</span></div>
              <p className="mt-1">{s.problem}</p>
              <p className="mt-1 text-[11px] text-muted">Evidence {s.evidenceIds.length} · {s.extractedBy}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
