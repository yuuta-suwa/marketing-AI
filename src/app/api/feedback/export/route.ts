import { NextResponse } from "next/server";
import { lineageCsv } from "@/application/executive/feedback";
import { buildAppContext, getSession } from "@/infrastructure/server-context";

export const dynamic = "force-dynamic";

/** Signal → Opportunity → Experiment → Revenue learning dataset (CSV). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const csv = await lineageCsv(buildAppContext(session));
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="market-radar-lineage.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}
