import { z } from "zod";
import { EpistemicStatusSchema } from "../shared/epistemic";

/** The twelve questions every important opportunity must survive. */
export const RED_TEAM_QUESTIONS = [
  { key: "why_not_buy", ja: "なぜ顧客は買わないのか" },
  { key: "status_quo_enough", ja: "なぜ現在の方法で十分なのか" },
  { key: "cannot_beat_competitors", ja: "なぜ競合に勝てないのか" },
  { key: "imitation", ja: "競合はどう模倣するのか" },
  { key: "distribution", ja: "Distributionは成立するか" },
  { key: "cac", ja: "CACは成立するか" },
  { key: "gross_margin", ja: "十分な粗利が出るか" },
  { key: "ai_necessity", ja: "AIである必要はあるか" },
  { key: "regulation", ja: "法規制は問題ないか" },
  { key: "biggest_assumption", ja: "最大の思い込みは何か" },
  { key: "worst_case", ja: "Worst Caseは何か" },
  { key: "exit_criteria", ja: "撤退条件は何か" },
] as const;
export type RedTeamQuestionKey = (typeof RED_TEAM_QUESTIONS)[number]["key"];

export const RedTeamFindingSchema = z.object({
  key: z.enum(RED_TEAM_QUESTIONS.map((q) => q.key) as [RedTeamQuestionKey, ...RedTeamQuestionKey[]]),
  question: z.string().min(1),
  answer: z.string().trim().min(1).max(2000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  epistemic: EpistemicStatusSchema,
  evidenceIds: z.array(z.string()).default([]),
});
export type RedTeamFinding = z.infer<typeof RedTeamFindingSchema>;

export const RedTeamReviewSchema = z.object({
  findings: z.array(RedTeamFindingSchema).length(RED_TEAM_QUESTIONS.length),
  biggestAssumption: z.string().min(1),
  worstCase: z.string().min(1),
  killCriteria: z.string().min(1),
  verdict: z.enum(["PROCEED", "PROCEED_WITH_CAUTION", "NEEDS_EVIDENCE", "STOP"]),
});
export type RedTeamReview = z.infer<typeof RedTeamReviewSchema>;

export function deriveVerdict(findings: readonly RedTeamFinding[]): RedTeamReview["verdict"] {
  const critical = findings.filter((f) => f.severity === "CRITICAL").length;
  const high = findings.filter((f) => f.severity === "HIGH").length;
  const unsupported = findings.filter((f) => f.epistemic === "HYPOTHESIS" || f.epistemic === "ASSUMPTION").length;
  if (critical > 0) return "STOP";
  if (unsupported > findings.length / 2) return "NEEDS_EVIDENCE";
  if (high >= 3) return "PROCEED_WITH_CAUTION";
  return "PROCEED";
}
