import { HARD_LIMIT_ENV, hardLimitsFromEnv } from "@/application/limits";

/**
 * The environment contract (docs/ENVIRONMENT.md mirrors this list).
 *   REQUIRED_FOR_CORE      — production cannot run without it
 *   REQUIRED_FOR_CONNECTOR — a specific connector/provider is LIVE only with it
 *   OPTIONAL               — tuning / optional providers
 *   DEVELOPMENT_ONLY       — must not be enabled in production
 */
export type EnvCategory = "REQUIRED_FOR_CORE" | "REQUIRED_FOR_CONNECTOR" | "OPTIONAL" | "DEVELOPMENT_ONLY";
/** "tooling": operator scripts only (golden-run, verify:hosted-db, advisors) — never deployed. */
export type EnvScope = "web" | "worker" | "both" | "tooling";

export type EnvVarSpec = {
  name: string;
  category: EnvCategory;
  scope: EnvScope;
  secret: boolean;
  description: string;
  /** Connector / provider this unlocks (REQUIRED_FOR_CONNECTOR). */
  unlocks?: string;
};

export const ENV_CONTRACT: readonly EnvVarSpec[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", category: "REQUIRED_FOR_CORE", scope: "both", secret: false, description: "Supabase project URL" },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", category: "REQUIRED_FOR_CORE", scope: "web", secret: false, description: "Publishable (or legacy anon) key; RLS protects data" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", category: "REQUIRED_FOR_CORE", scope: "worker", secret: true, description: "Worker + /api/cron only. Never in the browser or in user request paths" },
  { name: "CRON_SECRET", category: "REQUIRED_FOR_CORE", scope: "web", secret: true, description: "Bearer secret for /api/cron/* (≥16 chars)" },
  { name: "ANTHROPIC_API_KEY", category: "REQUIRED_FOR_CONNECTOR", scope: "both", secret: true, description: "LLM agents (deterministic fallbacks run without it)", unlocks: "anthropic" },
  { name: "BRAVE_SEARCH_API_KEY", category: "REQUIRED_FOR_CONNECTOR", scope: "worker", secret: true, description: "Brave Search API subscription token", unlocks: "web_search" },
  { name: "WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED", category: "REQUIRED_FOR_CONNECTOR", scope: "worker", secret: false, description: "true once your Brave plan permits storing results", unlocks: "web_search" },
  { name: "ESTAT_APP_ID", category: "REQUIRED_FOR_CONNECTOR", scope: "worker", secret: true, description: "e-Stat API application id", unlocks: "estat" },
  { name: "X_BEARER_TOKEN", category: "REQUIRED_FOR_CONNECTOR", scope: "worker", secret: true, description: "X API v2 bearer token", unlocks: "x" },
  { name: "X_TERMS_CONFIRMED", category: "REQUIRED_FOR_CONNECTOR", scope: "worker", secret: false, description: "true once the developer terms for your tier were reviewed", unlocks: "x" },
  { name: "GOOGLE_PLACES_API_KEY", category: "REQUIRED_FOR_CONNECTOR", scope: "worker", secret: true, description: "Google Places (connector PENDING_REVIEW: will not run)", unlocks: "google_places" },
  { name: "TRIPADVISOR_API_KEY", category: "REQUIRED_FOR_CONNECTOR", scope: "worker", secret: true, description: "Tripadvisor Content API (PENDING_REVIEW: will not run)", unlocks: "tripadvisor" },
  { name: "OPENAI_API_KEY", category: "REQUIRED_FOR_CONNECTOR", scope: "worker", secret: true, description: "Only with EMBEDDING_PROVIDER=openai", unlocks: "openai_embeddings" },
  { name: "AI_PROVIDER", category: "OPTIONAL", scope: "both", secret: false, description: "anthropic | none (default: anthropic when the key is set)" },
  { name: "ANTHROPIC_MODEL", category: "OPTIONAL", scope: "both", secret: false, description: "Override the default model id" },
  { name: "ANTHROPIC_EFFORT", category: "OPTIONAL", scope: "both", secret: false, description: "low | medium | high" },
  { name: "EMBEDDING_PROVIDER", category: "OPTIONAL", scope: "worker", secret: false, description: "local (default) | openai" },
  { name: "OPENAI_EMBEDDING_MODEL", category: "OPTIONAL", scope: "worker", secret: false, description: "Default text-embedding-3-small" },
  { name: "GEMINI_API_KEY", category: "OPTIONAL", scope: "both", secret: true, description: "Reserved (adapter not implemented)" },
  ...Object.values(HARD_LIMIT_ENV).map(
    (name): EnvVarSpec => ({ name, category: "OPTIONAL", scope: "worker", secret: false, description: "Hard cost/volume limit (caps organization budgets)" }),
  ),
  { name: "WORKER_ID", category: "OPTIONAL", scope: "worker", secret: false, description: "Stable worker name in logs/leases (default: hostname-pid)" },
  { name: "WORKER_CONCURRENCY", category: "OPTIONAL", scope: "worker", secret: false, description: "Jobs claimed per poll (default 1)" },
  { name: "WORKER_POLL_INTERVAL_MS", category: "OPTIONAL", scope: "worker", secret: false, description: "Idle poll interval (default 2000)" },
  { name: "WORKER_LEASE_SECONDS", category: "OPTIONAL", scope: "worker", secret: false, description: "Job lease length (default 120)" },
  { name: "WORKER_HEALTH_PORT", category: "OPTIONAL", scope: "worker", secret: false, description: "Port for the worker's /healthz (default: disabled)" },
  { name: "WORKER_MODE", category: "OPTIONAL", scope: "web", secret: false, description: "external (default) | embedded (development only: drains the queue inside next dev)" },
  { name: "APP_ENV", category: "REQUIRED_FOR_CORE", scope: "both", secret: false, description: "Environment identity: local | staging | production (required for production builds)" },
  { name: "GOLDEN_RUN_USER_ID", category: "OPTIONAL", scope: "tooling", secret: false, description: "Golden Run: existing member/owner user in the hosted project" },
  { name: "GOLDEN_RUN_ORG_ID", category: "OPTIONAL", scope: "tooling", secret: false, description: "Golden Run: target organization (default: the user's default organization)" },
  { name: "GOLDEN_RUN_TIMEOUT_SECONDS", category: "OPTIONAL", scope: "tooling", secret: false, description: "Golden Run: max wait for the deployed worker (default 900)" },
  { name: "SUPABASE_DB_URL", category: "OPTIONAL", scope: "tooling", secret: true, description: "verify:hosted-db: Postgres connection string of the hosted project" },
  { name: "SUPABASE_ACCESS_TOKEN", category: "OPTIONAL", scope: "tooling", secret: true, description: "supabase-advisors.sh: personal access token (Management API)" },
  { name: "SUPABASE_PROJECT_REF", category: "OPTIONAL", scope: "tooling", secret: false, description: "supabase-advisors.sh: project ref" },
  { name: "APP_VERSION", category: "OPTIONAL", scope: "both", secret: false, description: "Release/commit shown in worker health (default: VERCEL_GIT_COMMIT_SHA / GIT_COMMIT_SHA / dev)" },
  { name: "ALLOW_MOCK_IN_PRODUCTION", category: "DEVELOPMENT_ONLY", scope: "both", secret: false, description: "Second explicit flag for a production mock override (flagged everywhere). Never set it normally" },
  { name: "MRO_DEMO_MODE", category: "DEVELOPMENT_ONLY", scope: "web", secret: false, description: "In-process demo store without Supabase. Rejected in production" },
  { name: "CONNECTOR_MOCK_MODE", category: "DEVELOPMENT_ONLY", scope: "both", secret: false, description: "Run adapters against canned responses ([MOCK]). Needs NODE_ENV!=production or ENABLE_MOCK_CONNECTORS=true" },
  { name: "ENABLE_MOCK_CONNECTORS", category: "DEVELOPMENT_ONLY", scope: "both", secret: false, description: "Explicit test-deployment opt-in (staging/E2E): allows mock connectors and the demo store even when NODE_ENV=production" },
  { name: "CONNECTOR_MOCK_FAIL", category: "DEVELOPMENT_ONLY", scope: "both", secret: false, description: "Comma-separated connector ids to fail in mock mode" },
  { name: "MRO_LOG_IN_TESTS", category: "DEVELOPMENT_ONLY", scope: "both", secret: false, description: "Print structured logs during vitest" },
];

type Env = Record<string, string | undefined>;
const val = (env: Env, name: string) => {
  const v = env[name];
  return v && v.trim() !== "" ? v : undefined;
};

/**
 * Explicit environment identity. Security-relevant behaviour (mock policy,
 * demo store, embedded worker) keys off APP_ENV — never off hostnames.
 * A production build without APP_ENV is treated as production (strictest)
 * and reported as a configuration error.
 */
export const APP_ENVS = ["local", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export function resolveAppEnv(env: Env = process.env): { appEnv: AppEnv; explicit: boolean; invalid?: string } {
  const raw = val(env, "APP_ENV")?.toLowerCase();
  if (raw && (APP_ENVS as readonly string[]).includes(raw)) return { appEnv: raw as AppEnv, explicit: true };
  if (raw) return { appEnv: "production", explicit: false, invalid: raw };
  return { appEnv: env.NODE_ENV === "production" ? "production" : "local", explicit: false };
}

export function appEnv(env: Env = process.env): AppEnv {
  return resolveAppEnv(env).appEnv;
}

export function isProduction(env: Env = process.env): boolean {
  return appEnv(env) === "production";
}

/** CONNECTOR_MOCK_MODE=true asks for canned connector responses. */
export function mockConnectorsRequested(env: Env = process.env): boolean {
  return val(env, "CONNECTOR_MOCK_MODE") === "true";
}

/**
 * local: allowed · staging: only with ENABLE_MOCK_CONNECTORS=true ·
 * production: disabled; an override needs ENABLE_MOCK_CONNECTORS=true AND
 * ALLOW_MOCK_IN_PRODUCTION=true and is flagged everywhere (banner, health, logs).
 * Connector failures, missing credentials or quota errors never select mocks.
 */
export function mockConnectorsAllowed(env: Env = process.env): boolean {
  switch (appEnv(env)) {
    case "local":
      return true;
    case "staging":
      return val(env, "ENABLE_MOCK_CONNECTORS") === "true";
    case "production":
      return val(env, "ENABLE_MOCK_CONNECTORS") === "true" && val(env, "ALLOW_MOCK_IN_PRODUCTION") === "true";
  }
}

/** True when this process explicitly overrides production mock protection. */
export function productionMockOverride(env: Env = process.env): boolean {
  return isProduction(env) && mockConnectorsRequested(env) && mockConnectorsAllowed(env);
}

/** The in-process demo store: local, or staging with the explicit test opt-in. Never production. */
export function demoStoreAllowed(env: Env = process.env): boolean {
  if (val(env, "MRO_DEMO_MODE") !== "true") return false;
  const e = appEnv(env);
  return e === "local" || (e === "staging" && val(env, "ENABLE_MOCK_CONNECTORS") === "true");
}

export class EnvironmentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n - ${problems.join("\n - ")}`);
    this.name = "EnvironmentError";
  }
}

export type EnvReport = {
  role: "web" | "worker";
  appEnv: AppEnv;
  production: boolean;
  /** An explicit production mock override is active (must be visible everywhere). */
  mockOverride: boolean;
  errors: string[];
  warnings: string[];
  /** Connectors/providers whose credentials are missing → READY_NEEDS_CREDENTIALS. */
  missingConnectorCredentials: Array<{ unlocks: string; env: string[] }>;
};

/**
 * Validates the environment for a process role. Errors mean the process must
 * not serve production traffic; the worker refuses to start on errors.
 */
export function validateEnvironment(role: "web" | "worker", env: Env = process.env): EnvReport {
  const identity = resolveAppEnv(env);
  const production = identity.appEnv === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  if (identity.invalid) errors.push(`APP_ENV=${identity.invalid} is invalid (use local, staging or production); treating it as production`);
  else if (!identity.explicit && env.NODE_ENV === "production") {
    errors.push("APP_ENV must be set explicitly (local, staging or production) for a production build; assuming production");
  }
  if (identity.explicit && identity.appEnv === "production" && env.NODE_ENV !== "production") {
    warnings.push("APP_ENV=production but NODE_ENV is not production (development build or tsx without NODE_ENV)");
  }
  if (identity.explicit && identity.appEnv === "local" && env.NODE_ENV === "production") {
    warnings.push("APP_ENV=local on a production build: mock connectors and the demo store are permitted");
  }

  const core = ENV_CONTRACT.filter((v) => v.category === "REQUIRED_FOR_CORE" && (v.scope === "both" || v.scope === role));
  const supabaseConfigured = Boolean(val(env, "NEXT_PUBLIC_SUPABASE_URL"));
  const demo = val(env, "MRO_DEMO_MODE") === "true";
  // Demo store without Supabase: local development, or an explicit staging test deployment (E2E).
  const demoDeployment = demoStoreAllowed(env) && !supabaseConfigured;
  for (const v of core) {
    if (v.name === "APP_ENV") continue; // validated explicitly above
    if (v.name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" && val(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY")) continue;
    if (!val(env, v.name)) {
      const msg = `${v.name} is required (${v.description})`;
      if (role === "web" && demoDeployment) continue;
      if (identity.appEnv !== "local" || role === "worker" || supabaseConfigured) errors.push(msg);
      else warnings.push(msg);
    }
  }
  if (val(env, "CRON_SECRET") && (val(env, "CRON_SECRET") ?? "").length < 16) errors.push("CRON_SECRET must be at least 16 characters");
  const url = val(env, "NEXT_PUBLIC_SUPABASE_URL");
  if (url && identity.appEnv !== "local" && !url.startsWith("https://")) errors.push("NEXT_PUBLIC_SUPABASE_URL must use https outside local");

  if (demo && !demoStoreAllowed(env)) {
    errors.push(
      identity.appEnv === "production"
        ? "MRO_DEMO_MODE=true is never allowed with APP_ENV=production"
        : "MRO_DEMO_MODE=true on staging requires the explicit test-deployment opt-in ENABLE_MOCK_CONNECTORS=true",
    );
  }
  if (demoDeployment && identity.appEnv === "staging") {
    warnings.push("Staging test deployment: in-process demo store (not for real data).");
  }
  if (mockConnectorsRequested(env) && !mockConnectorsAllowed(env)) {
    errors.push(
      identity.appEnv === "production"
        ? "CONNECTOR_MOCK_MODE=true is rejected with APP_ENV=production (an override needs ENABLE_MOCK_CONNECTORS=true and ALLOW_MOCK_IN_PRODUCTION=true)"
        : "CONNECTOR_MOCK_MODE=true on staging requires ENABLE_MOCK_CONNECTORS=true",
    );
  }
  const mockOverride = productionMockOverride(env);
  if (mockOverride) warnings.push("PRODUCTION MOCK OVERRIDE ACTIVE: connector results are synthetic and labelled [MOCK].");
  else if (mockConnectorsRequested(env) && mockConnectorsAllowed(env) && identity.appEnv === "staging") {
    warnings.push("Mock connectors are ENABLED on staging (ENABLE_MOCK_CONNECTORS=true). Results are synthetic and labelled [MOCK].");
  }
  if (val(env, "WORKER_MODE") === "embedded" && identity.appEnv !== "local") {
    errors.push("WORKER_MODE=embedded is local-only; deploy the external worker (npm run worker)");
  }

  // Explicit provider choices must not silently degrade.
  const ai = val(env, "AI_PROVIDER")?.toLowerCase();
  if (ai === "anthropic" && !val(env, "ANTHROPIC_API_KEY")) errors.push("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing");
  if (ai && !["anthropic", "none"].includes(ai)) errors.push(`AI_PROVIDER=${ai} is not implemented (use anthropic or none)`);
  if (val(env, "EMBEDDING_PROVIDER") === "openai" && !val(env, "OPENAI_API_KEY")) errors.push("EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is missing");
  try {
    hardLimitsFromEnv((n) => env[n]);
  } catch (e) {
    errors.push((e as Error).message);
  }

  const groups = new Map<string, string[]>();
  for (const v of ENV_CONTRACT.filter((x) => x.category === "REQUIRED_FOR_CONNECTOR" && x.unlocks)) {
    if (v.unlocks === "openai_embeddings" && val(env, "EMBEDDING_PROVIDER") !== "openai") continue;
    const missing = v.name.endsWith("_CONFIRMED") ? val(env, v.name) !== "true" : !val(env, v.name);
    if (missing) groups.set(v.unlocks!, [...(groups.get(v.unlocks!) ?? []), v.name]);
  }
  const missingConnectorCredentials = [...groups.entries()].map(([unlocks, names]) => ({ unlocks, env: names }));
  if (production && groups.has("web_search") && groups.has("estat")) {
    warnings.push("No live market source is configured (BRAVE_SEARCH_API_KEY / ESTAT_APP_ID): research will only use manual imports");
  }
  return { role, appEnv: identity.appEnv, production, mockOverride, errors, warnings, missingConnectorCredentials };
}

export function assertEnvironment(role: "web" | "worker", env: Env = process.env): EnvReport {
  const report = validateEnvironment(role, env);
  if (report.errors.length > 0) throw new EnvironmentError(report.errors);
  return report;
}

/**
 * Mock connector options for this process, or undefined for LIVE connectors.
 * Throws (never silently ignores or falls back) when production asks for mocks
 * without the explicit ENABLE_MOCK_CONNECTORS=true opt-in.
 */
export function resolveMockConnectorOptions(env: Env = process.env): { fail?: string[] } | undefined {
  if (!mockConnectorsRequested(env)) return undefined;
  if (!mockConnectorsAllowed(env)) {
    throw new EnvironmentError([`CONNECTOR_MOCK_MODE=true is rejected for APP_ENV=${appEnv(env)} (see docs/ENVIRONMENT.md mock policy)`]);
  }
  const fail = (env.CONNECTOR_MOCK_FAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { fail };
}

/** Release identifier for health output (never a secret). */
export function appVersion(env: Env = process.env): string {
  return (val(env, "APP_VERSION") ?? val(env, "VERCEL_GIT_COMMIT_SHA") ?? val(env, "GIT_COMMIT_SHA") ?? "dev").slice(0, 40);
}
