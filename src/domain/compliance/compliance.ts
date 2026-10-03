export const COMPLIANCE_STATUSES = [
  "APPROVED",
  "PENDING_REVIEW",
  "DISABLED_PENDING_COMPLIANCE",
  "BLOCKED",
] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export type AccessMethod = "OFFICIAL_API" | "LICENSED_FEED" | "USER_UPLOAD" | "NONE";

/** Static compliance profile declared by each connector implementation. */
export type ComplianceProfile = {
  status: ComplianceStatus;
  accessMethod: AccessMethod;
  termsUrl?: string;
  notes: string;
  /** Things the integration must never do. Documented per connector. */
  prohibitions: string[];
};

export const UNIVERSAL_PROHIBITIONS = [
  "規約違反のスクレイピング",
  "CAPTCHA回避",
  "認証回避",
  "アクセス制限・レート制限の回避",
] as const;

export type ConnectorGateInput = {
  profile: ComplianceProfile;
  /** Organization-level override (can only be stricter than the profile). */
  orgStatus?: ComplianceStatus;
  enabled: boolean;
  credentialsPresent: boolean;
  credentialsRequired: boolean;
};

export type ConnectorGateDecision =
  | { allowed: true }
  | { allowed: false; reason: "COMPLIANCE" | "DISABLED" | "CREDENTIALS"; message: string };

const STRICTNESS: Record<ComplianceStatus, number> = {
  APPROVED: 0,
  PENDING_REVIEW: 1,
  DISABLED_PENDING_COMPLIANCE: 2,
  BLOCKED: 3,
};

/** The effective status is the stricter of code profile and org override. */
export function effectiveComplianceStatus(profile: ComplianceStatus, org?: ComplianceStatus): ComplianceStatus {
  if (!org) return profile;
  return STRICTNESS[org] > STRICTNESS[profile] ? org : profile;
}

/**
 * Compliance gate: a connector may collect data only when its effective
 * status is APPROVED, it is enabled, and required credentials exist.
 */
export function evaluateConnectorGate(input: ConnectorGateInput): ConnectorGateDecision {
  const status = effectiveComplianceStatus(input.profile.status, input.orgStatus);
  if (status !== "APPROVED") {
    return { allowed: false, reason: "COMPLIANCE", message: `コンプライアンス状態が ${status} のため実行できません` };
  }
  if (!input.enabled) {
    return { allowed: false, reason: "DISABLED", message: "Connectorが無効です" };
  }
  if (input.credentialsRequired && !input.credentialsPresent) {
    return { allowed: false, reason: "CREDENTIALS", message: "認証情報が未設定です" };
  }
  return { allowed: true };
}
