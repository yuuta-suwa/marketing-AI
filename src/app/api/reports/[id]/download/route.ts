import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/infrastructure/server-context";

export const dynamic = "force-dynamic";

/** Markdown download of a report (session + RLS scoped). */
export async function GET(_req: NextRequest, { params }: RouteContext<"/api/reports/[id]/download">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const report = await session.repos.executive.getReport(id);
  if (!report) return NextResponse.json({ error: "not found" }, { status: 404 });
  const name = report.reportType === "CLAUDE_CODE_PROMPT" ? "CLAUDE_CODE_BUILD_PROMPT.md" : `${report.reportType.toLowerCase()}-${report.id.slice(0, 8)}.md`;
  return new NextResponse(report.contentMd, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
