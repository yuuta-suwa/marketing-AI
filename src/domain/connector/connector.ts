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
