import { HARD_LIMIT_ENV, hardLimitsFromEnv } from "@/application/limits";

/**
 * The environment contract (docs/ENVIRONMENT.md mirrors this list).
 *   REQUIRED_FOR_CORE      — production cannot run without it
 *   REQUIRED_FOR_CONNECTOR — a specific connector/provider is LIVE only with it
 *   OPTIONAL               — tuning / optional providers
 *   DEVELOPMENT_ONLY       — must not be enabled in production
 */
export type EnvCategory = "REQUIRED_FOR_CORE" | "REQUIRED_FOR_CONNECTOR" | "OPTIONAL" | "DEVELOPMENT_ONLY";
export type EnvScope = "web" | "worker" | "both";

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

export function isProduction(env: Env = process.env): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Mock connectors are allowed only outside production, or with the explicit
 * ENABLE_MOCK_CONNECTORS=true opt-in. Never a silent fallback.
 */
export function mockConnectorsRequested(env: Env = process.env): boolean {
  return val(env, "CONNECTOR_MOCK_MODE") === "true";
}

export function mockConnectorsAllowed(env: Env = process.env): boolean {
  return !isProduction(env) || val(env, "ENABLE_MOCK_CONNECTORS") === "true";
}

export class EnvironmentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n - ${problems.join("\n - ")}`);
    this.name = "EnvironmentError";
  }
}

export type EnvReport = {
  role: "web" | "worker";
  production: boolean;
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
  const production = isProduction(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  const core = ENV_CONTRACT.filter((v) => v.category === "REQUIRED_FOR_CORE" && (v.scope === "both" || v.scope === role));
  const supabaseConfigured = Boolean(val(env, "NEXT_PUBLIC_SUPABASE_URL"));
  const demo = val(env, "MRO_DEMO_MODE") === "true";
  // Demo store without Supabase: development, or an explicit test deployment (E2E).
  const demoDeployment = demo && !supabaseConfigured && (!production || val(env, "ENABLE_MOCK_CONNECTORS") === "true");
  for (const v of core) {
    if (v.name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" && val(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY")) continue;
    if (!val(env, v.name)) {
      const msg = `${v.name} is required (${v.description})`;
      if (role === "web" && demoDeployment) continue;
      if (production || role === "worker" || supabaseConfigured) errors.push(msg);
      else warnings.push(msg);
    }
  }
  if (val(env, "CRON_SECRET") && (val(env, "CRON_SECRET") ?? "").length < 16) errors.push("CRON_SECRET must be at least 16 characters");

  if (production && demo && val(env, "ENABLE_MOCK_CONNECTORS") !== "true") {
    errors.push("MRO_DEMO_MODE=true is not allowed when NODE_ENV=production (only in an explicit test deployment with ENABLE_MOCK_CONNECTORS=true)");
  }
  if (production && demo && val(env, "ENABLE_MOCK_CONNECTORS") === "true") {
    warnings.push("Test deployment: demo store enabled in a production build (ENABLE_MOCK_CONNECTORS=true). Not for real data.");
  }
  if (mockConnectorsRequested(env) && !mockConnectorsAllowed(env)) {
    errors.push("CONNECTOR_MOCK_MODE=true is rejected in production (set ENABLE_MOCK_CONNECTORS=true only for a staging/E2E deployment)");
  }
  if (production && mockConnectorsRequested(env) && mockConnectorsAllowed(env)) {
    warnings.push("Mock connectors are ENABLED in a production build (ENABLE_MOCK_CONNECTORS=true). Results are synthetic and labelled [MOCK].");
  }
  if (role === "web" && production && val(env, "WORKER_MODE") === "embedded") {
    errors.push("WORKER_MODE=embedded is development-only; deploy the external worker (npm run worker)");
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
  return { role, production, errors, warnings, missingConnectorCredentials };
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
    throw new EnvironmentError(["CONNECTOR_MOCK_MODE=true is rejected in production (ENABLE_MOCK_CONNECTORS=true is required for staging/E2E)"]);
  }
  const fail = (env.CONNECTOR_MOCK_FAIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { fail };
}
