import { NextResponse, type NextRequest } from "next/server";
import { enqueueScheduledJobs } from "@/application/executive/scheduled";
import { kickEmbeddedWorker } from "@/infrastructure/worker/embedded";
import { cronAuthorized, systemJobDeps } from "@/infrastructure/system-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Scheduled trigger. Requires Authorization: Bearer ${CRON_SECRET} (Vercel Cron sends it).
 * It only ENQUEUES one job per recipient (idempotent per time slot); the
 * background worker executes them, so the cron request stays short.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deps = systemJobDeps();
  if (!deps) return NextResponse.json({ error: "system jobs not configured (SUPABASE_SERVICE_ROLE_KEY)" }, { status: 503 });
  const result = await enqueueScheduledJobs(deps.dir, deps.store, "DAILY_BRIEF", new Date());
  kickEmbeddedWorker();
  console.log(JSON.stringify({ level: "info", msg: "cron.daily-brief", ...result }));
  return NextResponse.json(result);
}
