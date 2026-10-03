import { z } from "zod";

export const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export const ConfidenceLevelSchema = z.enum(CONFIDENCE_LEVELS);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

const RANK: Record<ConfidenceLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function minConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  return RANK[a] <= RANK[b] ? a : b;
}

export function confidenceFromRatio(ratio: number): ConfidenceLevel {
  if (ratio >= 0.7) return "HIGH";
  if (ratio >= 0.4) return "MEDIUM";
  return "LOW";
}
