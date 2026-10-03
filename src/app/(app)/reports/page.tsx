import Link from "next/link";
import { Tag } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await pageContext();
  const reports = await ctx.repos.executive.listReports({ limit: 100 });
  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Daily Market Brief・PoC仕様書・Claude Code Build Prompt"
        action={<a href="/api/feedback/export" className="rounded-xl border border-line px-3 py-2 text-xs">学習データCSV</a>}
      />
      {reports.length === 0 ? <EmptyState>レポートはまだありません</EmptyState> : (
        <ul className="space-y-1.5" data-testid="report-list">
          {reports.map((r) => (
            <li key={r.id}>
              <Link href={`/reports/${r.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                <span className="truncate">{r.title}</span><Tag>{r.reportType}</Tag>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
