import { effectiveComplianceStatus, evaluateConnectorGate, type ComplianceStatus } from "@/domain/compliance/compliance";
import { classifyConnectorError, type ConnectorErrorClass, type MarketConnector } from "@/domain/connector/connector";
import type { ConnectorSetting } from "@/application/ports/repositories";

export type ConnectorMode = "LIVE" | "MOCK" | "DISABLED";

/**
 * LIVE_READY              — the live smoke test passed just now
 * CONFIGURED_UNTESTED     — credentials present, smoke test not run (UI renders without network calls)
 * READY_NEEDS_CREDENTIALS — implemented and approvable; add the listed env vars
 * PENDING_COMPLIANCE      — implemented, but terms/licence review blocks execution
 * NOT_IMPLEMENTED         — scaffold only (no permitted access method yet)
 * MOCK                    — canned responses (development / staging only)
 * FAILED                  — smoke test failed (see errorClass)
 * NO_CREDENTIALS_REQUIRED — manual import (user-supplied data)
 */
export type ReadinessStatus =
  | "LIVE_READY"
  | "CONFIGURED_UNTESTED"
  | "READY_NEEDS_CREDENTIALS"
  | "PENDING_COMPLIANCE"
  | "NOT_IMPLEMENTED"
  | "MOCK"
  | "FAILED"
  | "NO_CREDENTIALS_REQUIRED";

export type ConnectorReadiness = {
  id: string;
  name: string;
  mode: ConnectorMode;
  readiness: ReadinessStatus;
  compliance: ComplianceStatus;
  /** Exact environment variables still missing (names only). */
  missingEnv: string[];
  smoke?: { ok: boolean; latencyMs: number; detail?: string; errorClass?: ConnectorErrorClass; message?: string; costUsd?: number };
};

/** Env vars the adapter needs that are absent (confirmation flags must be "true"). */
export function missingEnvFor(connector: MarketConnector, env: (name: string) => string | undefined): string[] {
  return connector.env
    .filter((e) => {
      const v = env(e.name);
      return e.name.endsWith("_CONFIRMED") ? v !== "true" : !v || v.trim() === "";
    })
    .map((e) => e.name);
}

/**
 * Readiness of one connector. With live=true and an approved, configured
 * connector, performs its single minimal smoke request (bounded by timeoutMs).
 */
export async function connectorReadiness(
  connector: MarketConnector,
  options: { env: (name: string) => string | undefined; setting?: ConnectorSetting; live?: boolean; timeoutMs?: number },
): Promise<ConnectorReadiness> {
  const profile = connector.complianceStatus();
  const enabled = options.setting?.enabled ?? connector.enabledByDefault;
  const gate = evaluateConnectorGate({
    profile,
    orgStatus: options.setting?.complianceStatus,
    enabled,
    credentialsPresent: connector.credentialsPresent(),
    credentialsRequired: connector.credentialsRequired,
  });
  const base = {
    id: connector.id,
    name: connector.name,
    compliance: profile.status,
    missingEnv: connector.synthetic ? [] : missingEnvFor(connector, options.env),
  };
  const mode: ConnectorMode = connector.synthetic ? "MOCK" : gate.allowed ? "LIVE" : "DISABLED";

  if (connector.synthetic) return { ...base, mode, readiness: "MOCK" };
  if (!connector.credentialsRequired) return { ...base, mode, readiness: "NO_CREDENTIALS_REQUIRED" };
  if (profile.status === "DISABLED_PENDING_COMPLIANCE" && !connector.smokeTest) return { ...base, mode, readiness: "NOT_IMPLEMENTED" };
  const credentialEnvMissing = base.missingEnv.some((n) => !n.endsWith("_CONFIRMED"));
  if (credentialEnvMissing) return { ...base, mode, readiness: "READY_NEEDS_CREDENTIALS" };
  if (effectiveComplianceStatus(profile.status, options.setting?.complianceStatus) !== "APPROVED") {
    return { ...base, mode, readiness: "PENDING_COMPLIANCE" };
  }
  if (!options.live || !connector.smokeTest) return { ...base, mode, readiness: "CONFIGURED_UNTESTED" };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
  try {
    const r = await connector.smokeTest(controller.signal);
    return { ...base, mode, readiness: "LIVE_READY", smoke: { ok: true, latencyMs: Date.now() - started, detail: r.detail, costUsd: r.costUsd } };
  } catch (e) {
    const c = classifyConnectorError(e);
    return {
      ...base,
      mode,
      readiness: "FAILED",
      smoke: { ok: false, latencyMs: Date.now() - started, errorClass: c.class, message: e instanceof Error ? e.message.slice(0, 300) : String(e) },
    };
  } finally {
    clearTimeout(timer);
  }
}
