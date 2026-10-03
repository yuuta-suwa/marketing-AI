import { ConfidenceBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "Clusters" };

export default async function ClustersPage() {
  const ctx = await pageContext();
  const clusters = await ctx.repos.signals.listClusters({ limit: 100 });
  return (
    <>
      <PageHeader title="Signal Clusters" />
      {clusters.length === 0 ? <EmptyState>クラスタはまだありません</EmptyState> : (
        <ul className="space-y-2">
          {clusters.map((c) => (
            <li key={c.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-semibold">{c.name}</span><ConfidenceBadge level={c.confidence} /></div>
              <p className="mt-1 text-xs text-muted">{c.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
