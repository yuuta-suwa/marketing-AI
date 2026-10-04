import type { ComplianceProfile } from "../compliance/compliance";
import type { CostEstimate } from "../cost/cost";
import type { ResearchDirective } from "../research/directive";
import type { RawSourceItem } from "../source/source-item";

export type ConnectorCategory =
  | "MANUAL"
  | "WEB"
  | "SOCIAL"
  | "COMMUNITY"
  | "COMMERCE"
  | "TRAVEL"
  | "TICKET"
  | "PUBLIC"
  | "B2B"
  | "APP_REVIEW"
  | "JOB_MARKET";

export type ConnectorHealth = {
  status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "NOT_CONFIGURED";
  message?: string;
  checkedAt: string;
  latencyMs?: number;
};

export type ConnectorContext = {
  researchRunId: string;
  organizationId: string;
  /** Max items this connector may return for this run. */
  limit: number;
  signal?: AbortSignal;
  /** Manual import payload (ManualImportConnector only). */
  manualItems?: RawSourceItem[];
  /** User-supplied page URLs to import (ManualImportConnector only). */
  manualUrls?: string[];
  /** Non-fatal problems (e.g. one URL failed); the run is marked PARTIAL for this connector. */
  warn?: (message: string) => void;
  logger?: { info: (msg: string, data?: Record<string, unknown>) => void };
};

export type EnvRequirement = {
  name: string;
  description: string;
  secret: boolean;
};

/**
 * Port every market source implements. Business logic depends on this
 * interface only — never on a provider's API shape.
 */
export interface MarketConnector {
  readonly id: string;
  readonly name: string;
  readonly category: ConnectorCategory;
  readonly description: string;
  /** Environment variables the adapter needs (documented in .env.example). */
  readonly env: readonly EnvRequirement[];
  /** Typical reliability of this source for confidence scoring (0..1). */
  readonly sourceQuality: number;
  /** Whether the connector is enabled when the organization has no explicit setting. */
  readonly enabledByDefault: boolean;
  /** Whether search() needs server-side credentials. */
  readonly credentialsRequired: boolean;

  search(directive: ResearchDirective, context: ConnectorContext): Promise<RawSourceItem[]>;
  healthCheck(): Promise<ConnectorHealth>;
  complianceStatus(): ComplianceProfile;
  credentialsPresent(): boolean;
  estimateCost?(directive: ResearchDirective): Promise<CostEstimate>;
  /**
   * One minimal LIVE request proving credentials + connectivity (cheapest
   * endpoint, smallest page). Throws ConnectorError on failure. Never called
   * for connectors that are not compliance-approved.
   */
  smokeTest?(signal?: AbortSignal): Promise<{ detail: string; costUsd: number }>;
  /** True when the adapter runs against canned responses (MOCK mode). */
  readonly synthetic?: boolean;
}

export class ConnectorError extends Error {
  constructor(
    readonly connectorId: string,
    message: string,
    readonly retryable = false,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

/** Stable error classes for connector failures (logs, connector_runs, UI). */
export type ConnectorErrorClass =
  | "AUTH"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UPSTREAM_5XX"
  | "NETWORK"
  | "BAD_REQUEST"
  | "INVALID_RESPONSE"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export function classifyConnectorError(e: unknown): { class: ConnectorErrorClass; retryable: boolean } {
  const message = e instanceof Error ? e.message : String(e);
  const status = e instanceof ConnectorError ? e.status : undefined;
  if (status === 401 || status === 403) return { class: "AUTH", retryable: false };
  if (status === 429) return { class: "RATE_LIMITED", retryable: true };
  if (status !== undefined && status >= 500) return { class: "UPSTREAM_5XX", retryable: true };
  if (status !== undefined && status >= 400) return { class: "BAD_REQUEST", retryable: false };
  if (/timed out|timeout|abort/i.test(message)) return { class: "TIMEOUT", retryable: true };
  if (/network error|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(message)) return { class: "NETWORK", retryable: true };
  if (/not configured|未設定|missing credential/i.test(message)) return { class: "NOT_CONFIGURED", retryable: false };
  if (/json|unexpected token|invalid response|e-stat error/i.test(message)) return { class: "INVALID_RESPONSE", retryable: false };
  return { class: "UNKNOWN", retryable: e instanceof ConnectorError ? e.retryable : true };
}
