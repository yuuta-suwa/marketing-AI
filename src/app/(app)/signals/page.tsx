import { ConfidenceBadge, Tag } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/ui";
import { SIGNAL_TYPE_LABEL_JA } from "@/domain/signal/signal";
import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "Signals" };

export default async function SignalsPage({ searchParams }: PageProps<"/signals">) {
  const ctx = await pageContext();
  const page = pageFrom((await searchParams).page);
  const fetched = await ctx.repos.signals.listSignals({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const hasNext = fetched.length > PAGE_SIZE;
  const signals = fetched.slice(0, PAGE_SIZE);
  return (
    <>
      <PageHeader title="Market Signals" subtitle="新しい順" />
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
    <Pagination basePath="/signals" page={page} hasNext={hasNext} />
    </>
  );
}
