import type { StoredDecision, StoredRedTeamReview } from "@/application/ports/repositories";
import type { PipelineResult } from "@/application/research/pipeline";
import type { AdditionalResearchType } from "@/application/opportunity/additional-research";
import type { Opportunity } from "@/domain/opportunity/opportunity";
import type { ResearchRequest } from "@/domain/research/directive";

export type ExecutiveBriefing = {
  opportunityId: string;
  headline: string;
  score: number | null;
  confidence: string;
  interpretation: string;
  evidenceCount: number;
  redTeamVerdict: string | null;
  mainRisk: string | null;
  unknowns: string[];
  recommendedNextAction: string;
  availableActions: string[];
};

/**
 * FRIDAY is the executive interface: it routes intent to the research
 * engine and decision gates, and summarizes results for a human. It never
 * makes the final decision itself.
 * The local adapter talks to in-process services; an external FRIDAY can
 * implement the same interface over HTTP later.
 */
export interface ExecutiveAssistantAdapter {
  sendDirective(request: ResearchRequest): Promise<PipelineResult>;
  requestDeepResearch(opportunityId: string, type: AdditionalResearchType, note?: string): Promise<PipelineResult>;
  consult(opportunityId: string): Promise<ExecutiveBriefing>;
  openAdvisorCouncil(opportunityId: string): Promise<{ status: "NOT_AVAILABLE"; message: string }>;
  runRedTeam(opportunityId: string): Promise<StoredRedTeamReview>;
  approveOpportunity(opportunityId: string, toStatus: Opportunity["status"], rationale?: string): Promise<StoredDecision>;
  rejectOpportunity(opportunityId: string, rationale?: string): Promise<StoredDecision>;
  holdOpportunity(opportunityId: string, rationale?: string): Promise<StoredDecision>;
  watchOpportunity(opportunityId: string, rationale?: string): Promise<StoredDecision>;
  createExperiment(opportunityId: string): Promise<{ status: "NOT_AVAILABLE"; message: string }>;
  generatePoCSpec(opportunityId: string): Promise<{ status: "NOT_AVAILABLE"; message: string }>;
}
