import type { AppContext } from "@/application/context";
import type { DecisionKind, StoredDecision } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";
import type { Opportunity } from "@/domain/opportunity/opportunity";
import { assertOpportunityTransition, CEO_GATED_STATUSES, type OpportunityStatus } from "@/domain/opportunity/status";
import { DomainError } from "@/domain/shared/errors";

export type DecisionInput = {
  opportunityId: string;
  decision: DecisionKind;
  /** Required for APPROVE: the status being approved. */
  toStatus?: OpportunityStatus;
  rationale?: string;
  /** Decision memory fields. */
  subject?: string;
  source?: "UI" | "FRIDAY";
  advisorSessionId?: string;
};

const IMPLIED_STATUS: Partial<Record<DecisionKind, OpportunityStatus>> = {
  REJECT: "REJECTED",
  HOLD: "ON_HOLD",
  REQUEST_RESEARCH: "RESEARCHING",
};

/**
 * Human decision gate. The decision is recorded first (attributed to the
 * authenticated user — the database enforces decided_by = auth.uid()), then
 * the status changes. WATCH records intent without changing status.
 */
export async function decideOpportunity(
  ctx: AppContext,
  input: DecisionInput,
): Promise<{ decision: StoredDecision; opportunity: Opportunity }> {
  authorize(ctx.actor, "opportunity.decide");
  const opportunity = await ctx.repos.opportunities.getOpportunity(input.opportunityId);
  if (!opportunity) throw new DomainError("NOT_FOUND", "Opportunity not found");

  const to = input.decision === "APPROVE" ? input.toStatus : IMPLIED_STATUS[input.decision];
  if (input.decision === "APPROVE" && !to) throw new DomainError("VALIDATION", "toStatus is required for APPROVE");

  // CEO approval: starting PoC development or launching needs an admin/owner.
  if (to && CEO_GATED_STATUSES.has(to)) authorize(ctx.actor, "opportunity.ceo_approve");
  if (to && to !== opportunity.status) {
    const evidenceCount = (await ctx.repos.opportunities.listOpportunityEvidenceIds(opportunity.id)).length;
    assertOpportunityTransition(opportunity.status, to, { evidenceCount, humanDecisionRecorded: true });
  }

  const decision = await ctx.repos.opportunities.recordDecision({
    opportunityId: opportunity.id,
    decision: input.decision,
    fromStatus: opportunity.status,
    toStatus: to ?? null,
    rationale: input.rationale,
    subject: input.subject ?? `${input.decision}: ${opportunity.title}`.slice(0, 300),
    source: input.source ?? "UI",
    advisorSessionId: input.advisorSessionId,
  });
  const updated =
    to && to !== opportunity.status ? await ctx.repos.opportunities.setStatus(opportunity.id, to) : opportunity;
  if (input.decision === "WATCH") {
    await ctx.repos.executive.createWatchlist({ targetType: "OPPORTUNITY", targetId: opportunity.id, label: opportunity.title });
  }
  await ctx.repos.ops.audit("opportunity.decided", "opportunity", opportunity.id, {
    decision: input.decision,
    from: opportunity.status,
    to: updated.status,
  });
  return { decision, opportunity: updated };
}
