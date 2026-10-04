import { NextResponse } from "next/server";
import { validateEnvironment } from "@/infrastructure/env-contract";
import { runtimeMode } from "@/infrastructure/runtime-mode";
import { mockConnectorsActive } from "@/infrastructure/server-context";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness for the frontend (load balancers, uptime checks).
 * Public, so it reports only booleans/counts — never variable values or names.
 * The worker exposes its own /healthz (WORKER_HEALTH_PORT) with queue stats.
 */
export async function GET() {
  const env = validateEnvironment("web");
  const mode = runtimeMode();
  const ok = env.errors.length === 0 && mode !== "unconfigured";
  return NextResponse.json(
    { ok, mode, mockConnectors: mockConnectorsActive(), configErrors: env.errors.length, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
