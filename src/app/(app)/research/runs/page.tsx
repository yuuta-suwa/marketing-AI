import Link from "next/link";
import { RunStatusPill } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/ui";
import { RUN_TYPE_LABEL_JA } from "@/domain/research/run";
import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "調査履歴" };

export default async function RunsPage({ searchParams }: PageProps<"/research/runs">) {
  const ctx = await pageContext();
  const page = pageFrom((await searchParams).page);
  const fetched = await ctx.repos.research.listRuns({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const hasNext = fetched.length > PAGE_SIZE;
  const runs = fetched.slice(0, PAGE_SIZE);
  return (
    <>
      <PageHeader title="調査履歴" action={<Link href="/research/new" className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white">新規</Link>} />
      {runs.length === 0 ? <EmptyState>調査履歴はありません</EmptyState> : (
        <ul className="space-y-2">
          {runs.map((r) => (
            <li key={r.id}>
              <Link href={`/research/runs/${r.id}`} className="block rounded-xl border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{RUN_TYPE_LABEL_JA[r.runType]}</span>
                  <RunStatusPill status={r.status} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {new Date(r.createdAt).toLocaleString("ja-JP")} · 機会 {r.stats.opportunities ?? 0} · シグナル {r.stats.signals ?? 0} · ${r.costUsd.toFixed(4)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    <Pagination basePath="/research/runs" page={page} hasNext={hasNext} />
    </>
  );
}
