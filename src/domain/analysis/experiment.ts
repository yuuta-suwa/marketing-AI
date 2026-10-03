import { z } from "zod";
import { DomainError } from "../shared/errors";

export const EXPERIMENT_STATUSES = ["PROPOSED", "APPROVED", "RUNNING", "COMPLETED", "CANCELLED"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export const EXPERIMENT_DECISIONS = ["CONTINUE", "PIVOT", "STOP", "SCALE"] as const;
export type ExperimentDecision = (typeof EXPERIMENT_DECISIONS)[number];

export const ExperimentDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  hypothesis: z.string().trim().min(1).max(2000),
  method: z.string().trim().min(1).max(2000), // "Test"
  metric: z.string().trim().min(1).max(300),
  target: z.string().trim().min(1).max(300),
  budgetUsd: z.number().min(0).max(1_000_000), // "Cost"
  deadline: z.iso.date(),
  killCriteria: z.string().trim().max(1000).optional(),
});
export type ExperimentDraft = z.infer<typeof ExperimentDraftSchema>;

export type Experiment = ExperimentDraft & {
  id: string;
  opportunityId: string;
  status: ExperimentStatus;
  resultSummary?: string;
  decision?: ExperimentDecision;
  approvedBy?: string;
  decidedBy?: string;
  createdAt: string;
};

/** MUST match private.enforce_experiment_transition(). */
const NEXT: Record<ExperimentStatus, ExperimentStatus[]> = {
  PROPOSED: ["APPROVED", "CANCELLED"],
  APPROVED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertExperimentTransition(from: ExperimentStatus, to: ExperimentStatus, ctx: { resultSummary?: string }): void {
  if (from === to) return;
  if (!NEXT[from].includes(to)) throw new DomainError("ILLEGAL_TRANSITION", `Illegal experiment transition ${from} -> ${to}`);
  if (to === "COMPLETED" && !ctx.resultSummary?.trim()) throw new DomainError("VALIDATION", "完了には結果（Result）の記録が必要です");
}
