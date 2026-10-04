import type { AppContext } from "@/application/context";
import type { ReviewDecision, StoredQualityReview } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";

/** Records the signed-in human's judgement of a signal/opportunity (editable, audited). */
export async function recordQualityReview(
  ctx: AppContext,
  input: { researchRunId: string; entityType: "SIGNAL" | "OPPORTUNITY"; entityId: string; rating?: number | null; decision?: ReviewDecision; useful?: boolean; note?: string },
): Promise<StoredQualityReview> {
  authorize(ctx.actor, "opportunity.decide");
  const review = await ctx.repos.executive.upsertQualityReview(input);
  await ctx.repos.ops.audit("quality.reviewed", input.entityType === "SIGNAL" ? "signal" : "opportunity", input.entityId, {
    runId: input.researchRunId,
    rating: review.rating,
    decision: review.decision,
    useful: review.useful,
  });
  return review;
}
