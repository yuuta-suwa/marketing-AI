import { z } from "zod";

/**
 * Every persisted claim carries its epistemic status. AI output is never
 * stored as FACT unless it is a verbatim quote from a source.
 */
export const EPISTEMIC_STATUSES = ["FACT", "INFERENCE", "HYPOTHESIS", "ASSUMPTION", "CALCULATION"] as const;
export const EpistemicStatusSchema = z.enum(EPISTEMIC_STATUSES);
export type EpistemicStatus = z.infer<typeof EpistemicStatusSchema>;

export type Claim<T = string> = {
  value: T;
  epistemic: EpistemicStatus;
  /** Evidence ids that support the claim. Required for FACT. */
  evidenceIds?: string[];
  /** For CALCULATION: the formula used. */
  formula?: string;
};

export function assertClaimIsGrounded(claim: Claim<unknown>): void {
  if (claim.epistemic === "FACT" && (!claim.evidenceIds || claim.evidenceIds.length === 0)) {
    throw new Error("A FACT claim must cite at least one evidence id");
  }
  if (claim.epistemic === "CALCULATION" && !claim.formula) {
    throw new Error("A CALCULATION claim must include its formula");
  }
}
