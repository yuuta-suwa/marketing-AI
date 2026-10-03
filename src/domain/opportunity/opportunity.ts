import { z } from "zod";
import type { ConfidenceLevel } from "../shared/confidence";
import { EpistemicStatusSchema, type EpistemicStatus } from "../shared/epistemic";
import type { OpportunityStatus } from "./status";

export const OPPORTUNITY_TEXT_FIELDS = [
  "customer",
  "trigger",
  "situation",
  "pain",
  "desiredOutcome",
  "currentAlternatives",
  "marketGap",
  "paySignal",
  "marketSizeSummary",
  "competitorsSummary",
  "revenueModel",
  "distributionStrategy",
  "moat",
  "aiNecessity",
  "regulatoryRisk",
  "mainRisk",
  "nextExperiment",
  "killCriteria",
] as const;
export type OpportunityTextField = (typeof OPPORTUNITY_TEXT_FIELDS)[number];

const field = z.string().trim().min(1).max(2000);

/** Shape an opportunity generator (AI or rules) must output. */
export const OpportunityDraftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  customer: field.optional(),
  trigger: field.optional(),
  situation: field.optional(),
  pain: field,
  desiredOutcome: field.optional(),
  currentAlternatives: field.optional(),
  marketGap: field.optional(),
  paySignal: field.optional(),
  marketSizeSummary: field.optional(),
  competitorsSummary: field.optional(),
  revenueModel: field.optional(),
  distributionStrategy: field.optional(),
  moat: field.optional(),
  aiNecessity: field.optional(),
  regulatoryRisk: field.optional(),
  mainRisk: field.optional(),
  nextExperiment: field.optional(),
  killCriteria: field.optional(),
  fieldProvenance: z.record(z.string(), EpistemicStatusSchema),
  evidenceIds: z.array(z.string()).min(1).max(100),
});
export type OpportunityDraft = z.infer<typeof OpportunityDraftSchema>;

export type Opportunity = Omit<OpportunityDraft, "evidenceIds"> & {
  id: string;
  organizationId: string;
  researchRunId: string;
  clusterId: string;
  status: OpportunityStatus;
  confidence: ConfidenceLevel;
  scoreTotal: number | null;
  momentum: number;
  fieldProvenance: Record<string, EpistemicStatus>;
  createdAt: string;
  updatedAt: string;
};
