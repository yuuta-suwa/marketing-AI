import Link from "next/link";
import { notFound } from "next/navigation";
import { Tag } from "@/components/badges";
import { Card, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "Report" };

export default async function ReportPage({ params }: PageProps<"/reports/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await pageContext();
  const report = await ctx.repos.executive.getReport(id);
  if (!report) notFound();
  return (
    <>
      <PageHeader title={report.title} subtitle={<Tag>{report.reportType}</Tag>} action={<a href={`/api/reports/${report.id}/download`} className="rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-white">.md</a>} />
      {report.opportunityId ? <p className="mb-2 text-sm"><Link className="underline" href={`/opportunities/${report.opportunityId}`}>事業機会へ</Link></p> : null}
      <Card><pre className="whitespace-pre-wrap break-words font-sans text-sm" data-testid="report-content">{report.contentMd}</pre></Card>
    </>
  );
}
