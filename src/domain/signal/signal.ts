import { z } from "zod";
import { ConfidenceLevelSchema } from "../shared/confidence";
import { EpistemicStatusSchema } from "../shared/epistemic";

export const SIGNAL_TYPES = [
  "PAIN",
  "ANXIETY",
  "REQUEST",
  "SHORTAGE",
  "WORKAROUND",
  "SWITCHING",
  "PAY_SIGNAL",
  "PRICE_GAP",
  "ACCESS_GAP",
  "TRUST_GAP",
  "INFORMATION_GAP",
  "DISTRIBUTION_GAP",
  "CAPACITY_GAP",
  "REGULATION_GAP",
] as const;
export const SignalTypeSchema = z.enum(SIGNAL_TYPES);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const SIGNAL_TYPE_LABEL_JA: Record<SignalType, string> = {
  PAIN: "不満・痛み",
  ANXIETY: "不安",
  REQUEST: "要望",
  SHORTAGE: "不足・欠品",
  WORKAROUND: "代替行動",
  SWITCHING: "乗換意向",
  PAY_SIGNAL: "支払意思",
  PRICE_GAP: "価格差",
  ACCESS_GAP: "アクセス格差",
  TRUST_GAP: "信頼不足",
  INFORMATION_GAP: "情報不足",
  DISTRIBUTION_GAP: "流通摩擦",
  CAPACITY_GAP: "供給不足・待ち時間",
  REGULATION_GAP: "制度・規制",
};

const score = z.number().int().min(0).max(100);
const optionalText = z.string().trim().min(1).max(1000).optional();

/**
 * Validated shape of a market signal as produced by an extractor (AI or rules).
 * evidenceIds MUST reference evidence given to the extractor; this is checked
 * separately against the known set (see validateEvidenceRefs).
 */
export const MarketSignalSchema = z.object({
  persona: optionalText,
  situation: optionalText,
  problem: z.string().trim().min(1).max(2000),
  desiredOutcome: optionalText,
  currentAlternative: optionalText,
  alternativeFailure: optionalText,
  urgencyScore: score,
  frequencySignal: score,
  willingnessToPayScore: score,
  switchingIntentScore: score,
  trustIssue: z.boolean(),
  priceIssue: z.boolean(),
  accessIssue: z.boolean(),
  category: z.string().trim().max(120).optional(),
  location: z.string().trim().max(200).optional(),
  signalType: SignalTypeSchema,
  evidenceIds: z.array(z.string().min(1)).min(1).max(50),
  confidence: ConfidenceLevelSchema,
  /** Per-field epistemic status, e.g. { problem: "FACT", urgencyScore: "INFERENCE" }. */
  fieldProvenance: z.record(z.string(), EpistemicStatusSchema).optional(),
});
export type MarketSignal = z.infer<typeof MarketSignalSchema>;

export type StoredSignal = MarketSignal & {
  id: string;
  researchRunId: string;
  language?: string;
  country?: string;
  extractedBy: string;
  embedding?: number[];
  embeddingModel?: string;
  createdAt: string;
};

export const SignalExtractionOutputSchema = z.object({
  signals: z.array(MarketSignalSchema).max(200),
});
