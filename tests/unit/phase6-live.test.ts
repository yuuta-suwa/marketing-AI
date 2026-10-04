import { describe, expect, it } from "vitest";
import { workerHealthStatus, type WorkerSnapshot } from "@/domain/ops/worker-health";
import { blockingCredentials, credentialStatusMap, diagnoseCredentials } from "@/infrastructure/credentials";
import {
  demoStoreAllowed,
  mockConnectorsAllowed,
  productionMockOverride,
  resolveAppEnv,
  resolveMockConnectorOptions,
  validateEnvironment,
} from "@/infrastructure/env-contract";

const core = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_0123456789abcdef0123",
  CRON_SECRET: "0123456789abcdef",
};

describe("environment identity (APP_ENV)", () => {
  it("is explicit; a production build without APP_ENV is treated as production and reported", () => {
    expect(resolveAppEnv({ APP_ENV: "staging", NODE_ENV: "production" })).toEqual({ appEnv: "staging", explicit: true });
    expect(resolveAppEnv({ NODE_ENV: "development" })).toEqual({ appEnv: "local", explicit: false });
    expect(resolveAppEnv({ NODE_ENV: "production" })).toEqual({ appEnv: "production", explicit: false });
    expect(resolveAppEnv({ APP_ENV: "prod" }).appEnv).toBe("production"); // invalid → strictest
    expect(validateEnvironment("web", { ...core, NODE_ENV: "production" }).errors.join()).toMatch(/APP_ENV must be set explicitly/);
    expect(validateEnvironment("web", { ...core, NODE_ENV: "production", APP_ENV: "prod" }).errors.join()).toMatch(/APP_ENV=prod is invalid/);
    expect(validateEnvironment("web", { ...core, NODE_ENV: "production", APP_ENV: "production" }).errors).toEqual([]);
  });

  it("does not infer security behaviour from hostnames", () => {
    // A production-looking URL does not make a local environment production, nor the reverse.
    expect(resolveAppEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://prod.example.supabase.co" }).appEnv).toBe("local");
    expect(validateEnvironment("web", { ...core, APP_ENV: "staging", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://insecure" }).errors.join()).toMatch(/https/);
  });
});

describe("mock policy by environment", () => {
  it("local: allowed · staging: explicit opt-in · production: off unless a flagged double opt-in", () => {
    expect(mockConnectorsAllowed({ APP_ENV: "local" })).toBe(true);
    expect(mockConnectorsAllowed({ APP_ENV: "staging" })).toBe(false);
    expect(mockConnectorsAllowed({ APP_ENV: "staging", ENABLE_MOCK_CONNECTORS: "true" })).toBe(true);
    expect(mockConnectorsAllowed({ APP_ENV: "production", ENABLE_MOCK_CONNECTORS: "true" })).toBe(false);
    expect(mockConnectorsAllowed({ APP_ENV: "production", ENABLE_MOCK_CONNECTORS: "true", ALLOW_MOCK_IN_PRODUCTION: "true" })).toBe(true);
  });

  it("production rejects mocks by default and flags an explicit override everywhere", () => {
    const prod = { ...core, NODE_ENV: "production", APP_ENV: "production" };
    expect(() => resolveMockConnectorOptions({ ...prod, CONNECTOR_MOCK_MODE: "true" })).toThrow(/rejected for APP_ENV=production/);
    expect(validateEnvironment("worker", { ...prod, CONNECTOR_MOCK_MODE: "true", ENABLE_MOCK_CONNECTORS: "true" }).errors.join()).toMatch(/ALLOW_MOCK_IN_PRODUCTION/);
    const override = { ...prod, CONNECTOR_MOCK_MODE: "true", ENABLE_MOCK_CONNECTORS: "true", ALLOW_MOCK_IN_PRODUCTION: "true" };
    expect(productionMockOverride(override)).toBe(true);
    const report = validateEnvironment("worker", override);
    expect(report.mockOverride).toBe(true);
    expect(report.warnings.join()).toMatch(/PRODUCTION MOCK OVERRIDE ACTIVE/);
    expect(productionMockOverride({ ...prod })).toBe(false);
  });

  it("the demo store is never available in production, even with every flag", () => {
    expect(demoStoreAllowed({ APP_ENV: "local", MRO_DEMO_MODE: "true" })).toBe(true);
    expect(demoStoreAllowed({ APP_ENV: "staging", MRO_DEMO_MODE: "true" })).toBe(false);
    expect(demoStoreAllowed({ APP_ENV: "staging", MRO_DEMO_MODE: "true", ENABLE_MOCK_CONNECTORS: "true" })).toBe(true);
    expect(demoStoreAllowed({ APP_ENV: "production", MRO_DEMO_MODE: "true", ENABLE_MOCK_CONNECTORS: "true", ALLOW_MOCK_IN_PRODUCTION: "true" })).toBe(false);
    expect(validateEnvironment("web", { ...core, NODE_ENV: "production", APP_ENV: "production", MRO_DEMO_MODE: "true" }).errors.join()).toMatch(/never allowed/);
  });

  it("embedded workers are local-only", () => {
    expect(validateEnvironment("web", { ...core, APP_ENV: "staging", NODE_ENV: "production", WORKER_MODE: "embedded" }).errors.join()).toMatch(/local-only/);
    expect(validateEnvironment("web", { ...core, APP_ENV: "local", WORKER_MODE: "embedded" }).errors).toEqual([]);
  });
});

describe("credential diagnostics", () => {
  const live = {
    ...core,
    BRAVE_SEARCH_API_KEY: "BSA0123456789abcdef",
    WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED: "true",
    ESTAT_APP_ID: "0123456789abcdef0123456789abcdef01234567",
    ANTHROPIC_API_KEY: "sk-ant-api03-0123456789abcdef",
  };

  it("reports statuses only — never values", () => {
    const d = diagnoseCredentials(live);
    const json = JSON.stringify(d);
    for (const secret of Object.values(live)) if (secret.length > 8) expect(json).not.toContain(secret);
    expect(credentialStatusMap(d)).toMatchObject({ BRAVE_SEARCH_API_KEY: "CONFIGURED", ANTHROPIC_API_KEY: "CONFIGURED", OPENAI_API_KEY: "MISSING" });
    expect(blockingCredentials(d)).toEqual([]); // OPENAI/X are optional
  });

  it("classifies MISSING / INVALID / READY / RATE_LIMITED / EXPIRED", () => {
    const d = diagnoseCredentials(
      { ...live, ESTAT_APP_ID: undefined, WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED: "yes", SUPABASE_SERVICE_ROLE_KEY: core.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      {
        anthropic: { ok: false, errorClass: "AUTH", message: "token expired" },
        web_search: { ok: false, errorClass: "RATE_LIMITED" },
        supabase: { ok: true },
      },
    );
    const m = credentialStatusMap(d);
    expect(m.ESTAT_APP_ID).toBe("MISSING");
    expect(m.WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED).toBe("INVALID");
    expect(m.SUPABASE_SERVICE_ROLE_KEY).toBe("INVALID"); // must differ from the publishable key
    expect(m.ANTHROPIC_API_KEY).toBe("EXPIRED");
    expect(m.BRAVE_SEARCH_API_KEY).toBe("RATE_LIMITED");
    expect(m.NEXT_PUBLIC_SUPABASE_URL).toBe("READY");
    expect(blockingCredentials(d).map((x) => x.name)).toEqual(
      expect.arrayContaining(["ESTAT_APP_ID", "WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY", "BRAVE_SEARCH_API_KEY"]),
    );
  });

  it("a connectivity failure is not reported as a bad credential", () => {
    const m = credentialStatusMap(diagnoseCredentials(live, { estat: { ok: false, errorClass: "TIMEOUT" } }));
    expect(m.ESTAT_APP_ID).toBe("CONFIGURED");
  });
});

describe("worker health status", () => {
  const now = new Date("2026-10-05T00:10:00Z");
  const w = (ageSeconds: number, extra: Partial<WorkerSnapshot> = {}): WorkerSnapshot => ({
    workerId: "w1",
    startedAt: "2026-10-05T00:00:00Z",
    lastHeartbeatAt: new Date(now.getTime() - ageSeconds * 1000).toISOString(),
    jobsProcessed: 10,
    jobsFailed: 0,
    currentJobType: null,
    busy: false,
    version: "abc",
    appEnv: "staging",
    diagnostics: {},
    ...extra,
  });

  it("HEALTHY / DEGRADED / OFFLINE", () => {
    expect(workerHealthStatus([w(10)], now).status).toBe("HEALTHY");
    expect(workerHealthStatus([w(120)], now).status).toBe("DEGRADED");
    expect(workerHealthStatus([w(10, { jobsProcessed: 6, jobsFailed: 4 })], now).status).toBe("DEGRADED");
    expect(workerHealthStatus([w(10)], now, { oldestQueuedSeconds: 600 }).status).toBe("DEGRADED");
    expect(workerHealthStatus([w(600)], now).status).toBe("OFFLINE");
    expect(workerHealthStatus([], now).status).toBe("OFFLINE");
  });
});
