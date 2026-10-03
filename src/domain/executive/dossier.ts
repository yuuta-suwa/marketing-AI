import type { CfoAnalysis } from "../analysis/cfo";
import type { Experiment } from "../analysis/experiment";
import type { MarketEstimateResult } from "../analysis/market-size";
import type { Evidence } from "../evidence/evidence";
import type { BusinessModelType } from "../opportunity/business-model";
import type { Opportunity } from "../opportunity/opportunity";
import type { RedTeamReview } from "../opportunity/red-team";
import type { ConfidenceBreakdown } from "../scoring/confidence";
import type { OpportunityScore } from "../scoring/score";

/** Everything the executive layer knows about one opportunity (read model). */
export type OpportunityDossier = {
  opportunity: Opportunity;
  evidence: Evidence[];
  score: OpportunityScore | null;
  confidence: ConfidenceBreakdown | null;
  redTeam: RedTeamReview | null;
  competitors: Array<{ name: string; competitorType: string; epistemicStatus: string }>;
  marketEstimate: (MarketEstimateResult & { id?: string }) | null;
  primaryModel: { modelType: BusinessModelType; fitScore: number; rationale?: string } | null;
  cfo: CfoAnalysis | null;
  experiments: Experiment[];
  signalTypes: string[];
};
