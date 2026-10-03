import { z } from "zod";

export const SCORE_CRITERIA = [
  "painSeverity",
  "frequency",
  "willingnessToPay",
  "marketSize",
  "trendMomentum",
  "existingSolutionGap",
  "distributionAdvantage",
  "monetizationQuality",
  "buildability",
  "defensibility",
  "regulatoryFeasibility",
  "timeToRevenue",
  "strategicFit",
  "socialValue",
] as const;
export type ScoreCriterion = (typeof SCORE_CRITERIA)[number];

export type ScoringWeights = Record<ScoreCriterion, number>;

/** Default weights (total 100). Overridable per organization (scoring_settings). */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  painSeverity: 15,
  frequency: 10,
  willingnessToPay: 10,
  marketSize: 10,
  trendMomentum: 8,
  existingSolutionGap: 8,
  distributionAdvantage: 7,
  monetizationQuality: 7,
  buildability: 6,
  defensibility: 5,
  regulatoryFeasibility: 5,
  timeToRevenue: 4,
  strategicFit: 2,
  socialValue: 3,
};

export const CRITERION_LABEL_JA: Record<ScoreCriterion, string> = {
  painSeverity: "痛みの深刻度",
  frequency: "発生頻度",
  willingnessToPay: "支払意思",
  marketSize: "市場規模",
  trendMomentum: "トレンド",
  existingSolutionGap: "既存解決策とのギャップ",
  distributionAdvantage: "流通優位性",
  monetizationQuality: "収益化の質",
  buildability: "構築容易性",
  defensibility: "防御力",
  regulatoryFeasibility: "規制面の実現性",
  timeToRevenue: "収益化までの速さ",
  strategicFit: "戦略適合",
  socialValue: "社会的価値",
};

export const ScoringWeightsSchema = z
  .object(Object.fromEntries(SCORE_CRITERIA.map((c) => [c, z.number().min(0).max(100)])) as Record<
    ScoreCriterion,
    z.ZodNumber
  >)
  .strict()
  .refine((w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 100) < 1e-9, {
    message: "Weights must sum to 100",
  });
