import type { ConnectorReadiness } from "@/application/connectors/readiness";

/**
 * Credential diagnostics for the live stack. Output is a status per variable
 * NAME — values are never returned, logged or rendered.
 *
 *   MISSING       not set
 *   INVALID       set but malformed (format check) or rejected by the provider (401/403)
 *   EXPIRED       rejected by the provider with an expiry message
 *   RATE_LIMITED  provider returned 429 during the live check
 *   CONFIGURED    set and well-formed; no live check performed (or connectivity failed)
 *   READY         a live check succeeded
 */
export type CredentialStatus = "CONFIGURED" | "MISSING" | "INVALID" | "EXPIRED" | "RATE_LIMITED" | "READY";

type Env = Record<string, string | undefined>;
type Check = { name: string; group: string; optional?: boolean; valid: (v: string, env: Env) => boolean; hint: string };

const v = (env: Env, n: string) => {
  const x = env[n];
  return x && x.trim() !== "" ? x.trim() : undefined;
};

/** The Golden Run credential contract (Phase 6). Optional entries never block. */
export const LIVE_CREDENTIALS: readonly Check[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", group: "supabase", valid: (x) => /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(x) || /^https:\/\//.test(x), hint: "https URL of the project" },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", group: "supabase", valid: (x) => x.length >= 20, hint: "publishable/anon key" },
  {
    name: "SUPABASE_SERVICE_ROLE_KEY",
    group: "supabase",
    valid: (x, env) => x.length >= 20 && x !== v(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") && x !== v(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    hint: "service-role/secret key (must differ from the publishable key)",
  },
  { name: "CRON_SECRET", group: "cron", valid: (x) => x.length >= 16, hint: "≥ 16 characters" },
  { name: "BRAVE_SEARCH_API_KEY", group: "web_search", valid: (x) => x.length >= 10 && !/\s/.test(x), hint: "Brave subscription token" },
  { name: "WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED", group: "web_search", valid: (x) => x === "true", hint: "must be exactly true" },
  { name: "ESTAT_APP_ID", group: "estat", valid: (x) => /^[A-Za-z0-9]{10,}$/.test(x), hint: "e-Stat application id" },
  { name: "ANTHROPIC_API_KEY", group: "anthropic", valid: (x) => x.startsWith("sk-ant-") && x.length > 20, hint: "starts with sk-ant-" },
  { name: "OPENAI_API_KEY", group: "openai_embeddings", optional: true, valid: (x) => x.startsWith("sk-"), hint: "starts with sk-" },
  { name: "X_BEARER_TOKEN", group: "x", optional: true, valid: (x) => x.length >= 20, hint: "X API bearer token" },
];

export type CredentialDiagnostic = { name: string; group: string; optional: boolean; status: CredentialStatus; detail?: string };

/** Live result of a provider check, by group (from connector readiness / pings). */
export type LiveCheck = { ok: boolean; errorClass?: string; message?: string };

export function liveCheckFromReadiness(r: Pick<ConnectorReadiness, "smoke">): LiveCheck | undefined {
  return r.smoke ? { ok: r.smoke.ok, errorClass: r.smoke.errorClass, message: r.smoke.message } : undefined;
}

export function diagnoseCredentials(env: Env, live: Partial<Record<string, LiveCheck>> = {}): CredentialDiagnostic[] {
  return LIVE_CREDENTIALS.map((c) => {
    const value = v(env, c.name);
    const base = { name: c.name, group: c.group, optional: Boolean(c.optional) };
    if (!value) return { ...base, status: "MISSING" as const };
    if (!c.valid(value, env)) return { ...base, status: "INVALID" as const, detail: c.hint };
    const check = live[c.group];
    if (!check) return { ...base, status: "CONFIGURED" as const };
    if (check.ok) return { ...base, status: "READY" as const };
    if (check.errorClass === "RATE_LIMITED") return { ...base, status: "RATE_LIMITED" as const };
    if (check.errorClass === "AUTH") {
      return { ...base, status: /expire/i.test(check.message ?? "") ? ("EXPIRED" as const) : ("INVALID" as const), detail: "rejected by provider" };
    }
    // Connectivity/upstream problems say nothing about the credential itself.
    return { ...base, status: "CONFIGURED" as const, detail: `live check inconclusive (${check.errorClass ?? "error"})` };
  });
}

/** Compact name → status map (published in worker health; no values). */
export function credentialStatusMap(diags: readonly CredentialDiagnostic[]): Record<string, CredentialStatus> {
  return Object.fromEntries(diags.map((d) => [d.name, d.status]));
}

/** Required (non-optional) credentials that are not usable. */
export function blockingCredentials(diags: readonly CredentialDiagnostic[]): CredentialDiagnostic[] {
  return diags.filter((d) => !d.optional && !["CONFIGURED", "READY"].includes(d.status));
}
