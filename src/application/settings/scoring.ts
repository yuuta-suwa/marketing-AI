import type { AppContext } from "@/application/context";
import { authorize } from "@/domain/auth/authorization";
import { ScoringWeightsSchema, type ScoringWeights } from "@/domain/scoring/criteria";
import { DomainError } from "@/domain/shared/errors";

/** Admin: change opportunity score weights (must total exactly 100). */
export async function updateScoringWeights(ctx: AppContext, weights: ScoringWeights) {
  authorize(ctx.actor, "scoring.configure");
  const parsed = ScoringWeightsSchema.safeParse(weights);
  if (!parsed.success) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    throw new DomainError("VALIDATION", `重みの合計は100にしてください（現在 ${total}）`);
  }
  const saved = await ctx.repos.ops.updateScoringWeights(parsed.data);
  await ctx.repos.ops.audit("scoring.updated", "scoring_settings", saved.id ?? undefined, { weights: parsed.data });
  return saved;
}
