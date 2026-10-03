import { DomainError } from "../shared/errors";

export const OPPORTUNITY_STATUSES = [
  "DISCOVERED",
  "RESEARCHING",
  "VALIDATED",
  "EXPERIMENT_PROPOSED",
  "EXPERIMENT_APPROVED",
  "POC_PROPOSED",
  "POC_APPROVED",
  "ON_HOLD",
  "REJECTED",
  "LAUNCHED",
] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/** MUST stay identical to private.opportunity_transition_allowed() in SQL. */
const TRANSITIONS: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  DISCOVERED: ["RESEARCHING", "VALIDATED", "ON_HOLD", "REJECTED"],
  RESEARCHING: ["DISCOVERED", "VALIDATED", "ON_HOLD", "REJECTED"],
  VALIDATED: ["RESEARCHING", "EXPERIMENT_PROPOSED", "ON_HOLD", "REJECTED"],
  EXPERIMENT_PROPOSED: ["VALIDATED", "EXPERIMENT_APPROVED", "ON_HOLD", "REJECTED"],
  EXPERIMENT_APPROVED: ["POC_PROPOSED", "ON_HOLD", "REJECTED"],
  POC_PROPOSED: ["EXPERIMENT_APPROVED", "POC_APPROVED", "ON_HOLD", "REJECTED"],
  POC_APPROVED: ["LAUNCHED", "ON_HOLD", "REJECTED"],
  ON_HOLD: ["DISCOVERED", "RESEARCHING", "VALIDATED", "REJECTED"],
  REJECTED: ["DISCOVERED"],
  LAUNCHED: ["ON_HOLD"],
};

/** Transitions into these states require a recorded human decision. */
export const HUMAN_GATED_STATUSES: ReadonlySet<OpportunityStatus> = new Set([
  "EXPERIMENT_APPROVED",
  "POC_APPROVED",
  "LAUNCHED",
  "REJECTED",
]);

/** States that assert the opportunity is real — require linked evidence. */
export const EVIDENCE_REQUIRED_STATUSES: ReadonlySet<OpportunityStatus> = new Set([
  "VALIDATED",
  "EXPERIMENT_PROPOSED",
  "EXPERIMENT_APPROVED",
  "POC_PROPOSED",
  "POC_APPROVED",
  "LAUNCHED",
]);

export function allowedNextStatuses(from: OpportunityStatus): readonly OpportunityStatus[] {
  return TRANSITIONS[from];
}

export function canTransitionOpportunity(from: OpportunityStatus, to: OpportunityStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export type GateContext = {
  evidenceCount: number;
  /** True when a human decision for exactly this transition has been recorded. */
  humanDecisionRecorded: boolean;
};

export function assertOpportunityTransition(
  from: OpportunityStatus,
  to: OpportunityStatus,
  ctx: GateContext,
): void {
  if (!canTransitionOpportunity(from, to)) {
    throw new DomainError("ILLEGAL_TRANSITION", `Illegal opportunity transition ${from} -> ${to}`, { from, to });
  }
  if (from === to) return;
  if (EVIDENCE_REQUIRED_STATUSES.has(to) && ctx.evidenceCount === 0) {
    throw new DomainError("EVIDENCE_INTEGRITY", `Cannot move to ${to} without linked evidence`);
  }
  if (HUMAN_GATED_STATUSES.has(to) && !ctx.humanDecisionRecorded) {
    throw new DomainError("FORBIDDEN", `Moving to ${to} requires a human decision`);
  }
}

export const OPPORTUNITY_STATUS_LABEL_JA: Record<OpportunityStatus, string> = {
  DISCOVERED: "発見",
  RESEARCHING: "調査中",
  VALIDATED: "検証済",
  EXPERIMENT_PROPOSED: "実験提案",
  EXPERIMENT_APPROVED: "実験承認",
  POC_PROPOSED: "PoC提案",
  POC_APPROVED: "PoC承認",
  ON_HOLD: "保留",
  REJECTED: "却下",
  LAUNCHED: "ローンチ",
};
