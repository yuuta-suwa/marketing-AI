import type { EpistemicStatus } from "../shared/epistemic";
import { clamp01, round } from "../shared/math";
import { SCORE_CRITERIA, ScoringWeightsSchema, type ScoreCriterion, type ScoringWeights } from "./criteria";

export type CriterionInput = {
  /** 0..1, or null when there is no basis to assess it yet. */
  value: number | null;
  rationale: string;
  epistemic: EpistemicStatus;
};

export type CriterionResult = CriterionInput & {
  weight: number;
  /** Value actually used (null -> neutral prior, flagged as ASSUMPTION). */
  appliedValue: number;
  points: number;
  assumed: boolean;
};

export type OpportunityScore = {
  total: number;
  components: Record<ScoreCriterion, CriterionResult>;
  /** Share of weight backed by an actual assessment (not a neutral prior). */
  coverage: number;
  missing: ScoreCriterion[];
};

/** Neutral prior for unassessed criteria. Recorded as an ASSUMPTION. */
export const UNASSESSED_PRIOR = 0.5;

/**
 * Weighted 0..100 score. Score answers "how attractive does this look?" —
 * it says nothing about how sure we are (see computeConfidence).
 */
export function computeOpportunityScore(
  inputs: Partial<Record<ScoreCriterion, CriterionInput>>,
  weights: ScoringWeights,
): OpportunityScore {
  ScoringWeightsSchema.parse(weights);
  const components = {} as Record<ScoreCriterion, CriterionResult>;
  let total = 0;
  let coveredWeight = 0;
  const missing: ScoreCriterion[] = [];

  for (const c of SCORE_CRITERIA) {
    const input = inputs[c];
    const weight = weights[c];
    const assumed = input?.value == null;
    const appliedValue = assumed ? UNASSESSED_PRIOR : clamp01(input!.value!);
    const points = weight * appliedValue;
    total += points;
    if (assumed) missing.push(c);
    else coveredWeight += weight;
    components[c] = {
      value: input?.value ?? null,
      rationale: input?.rationale ?? "未評価（中立値を仮定）",
      epistemic: assumed ? "ASSUMPTION" : input!.epistemic,
      weight,
      appliedValue,
      points: round(points, 2),
      assumed,
    };
  }
  return { total: round(total, 2), components, coverage: round(coveredWeight / 100, 4), missing };
}
