import type { AppContext } from "@/application/context";
import { authorize } from "@/domain/auth/authorization";
import { COMPLIANCE_STATUSES, effectiveComplianceStatus, type ComplianceStatus } from "@/domain/compliance/compliance";
import { DomainError } from "@/domain/shared/errors";

/**
 * Admin-only connector configuration. An organization may disable a
 * connector or make its compliance status stricter, never looser than the
 * code-level profile (which reflects the provider-terms review).
 */
export async function updateConnectorSetting(
  ctx: AppContext,
  input: { connectorKey: string; enabled: boolean; complianceStatus?: ComplianceStatus; termsNotes?: string },
): Promise<{ effectiveStatus: ComplianceStatus }> {
  authorize(ctx.actor, "connector.configure");
  const connector = ctx.connectors.get(input.connectorKey);
  if (!connector) throw new DomainError("NOT_FOUND", "Unknown connector");
  const profile = connector.complianceStatus().status;
  const requested = input.complianceStatus ?? profile;
  if (!COMPLIANCE_STATUSES.includes(requested)) throw new DomainError("VALIDATION", "Invalid compliance status");
  const effective = effectiveComplianceStatus(profile, requested);
  if (effective !== requested) {
    throw new DomainError("COMPLIANCE_BLOCKED", `組織設定でコンプライアンス状態を緩めることはできません（コード上の状態: ${profile}）`);
  }
  await ctx.repos.ops.upsertConnectorSetting({
    connectorKey: connector.id,
    displayName: connector.name,
    enabled: input.enabled,
    complianceStatus: requested,
    termsNotes: input.termsNotes?.slice(0, 2000),
  });
  await ctx.repos.ops.audit("connector.configured", "connector", undefined, {
    connector: connector.id,
    enabled: input.enabled,
    complianceStatus: requested,
  });
  return { effectiveStatus: effective };
}
