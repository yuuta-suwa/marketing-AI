import { NextResponse, type NextRequest } from "next/server";
import { runScheduledMonitoring } from "@/application/executive/scheduled";
import { cronAuthorized, systemJobDeps } from "@/infrastructure/system-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Scheduled job. Requires Authorization: Bearer ${CRON_SECRET} (Vercel Cron sends it). */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deps = systemJobDeps();
  if (!deps) return NextResponse.json({ error: "system jobs not configured (SUPABASE_SERVICE_ROLE_KEY)" }, { status: 503 });
  const result = await runScheduledMonitoring(deps.dir, deps.ctxFor);
  console.log(JSON.stringify({ level: "info", msg: "cron.monitor", ...result }));
  return NextResponse.json(result);
}
