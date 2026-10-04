import { supabasePublicConfig } from "./supabase/env";

export type RuntimeMode = "supabase" | "demo" | "unconfigured";

/**
 * supabase     : production mode (auth + RLS).
 * demo         : explicit opt-in (MRO_DEMO_MODE=true) when Supabase is not
 *                configured. Single in-process store, one demo user. Not for
 *                real data — the UI shows a DEMO banner.
 * unconfigured : neither — the UI explains which env vars are missing.
 */
export function runtimeMode(): RuntimeMode {
  if (supabasePublicConfig()) return "supabase";
  // A production build honours demo mode only for an explicit test deployment
  // (ENABLE_MOCK_CONNECTORS=true, e.g. E2E); validateEnvironment reports misuse.
  if (process.env.MRO_DEMO_MODE === "true" && (process.env.NODE_ENV !== "production" || process.env.ENABLE_MOCK_CONNECTORS === "true")) return "demo";
  return "unconfigured";
}
