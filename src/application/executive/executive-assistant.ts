import type { StoredAdvisorSession, StoredDecision, StoredRedTeamReview, StoredReport } from "@/application/ports/repositories";
import type { Experiment, ExperimentDraft } from "@/domain/analysis/experiment";
import type { ResearchDispatch } from "@/application/research/dispatch";
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
  /** Creates the run and queues it; returns at once (the worker executes it). */
  sendDirective(request: ResearchRequest): Promise<ResearchDispatch>;
  requestDeepResearch(opportunityId: string, type: AdditionalResearchType, note?: string): Promise<ResearchDispatch>;
  consult(opportunityId: string): Promise<ExecutiveBriefing>;
  openAdvisorCouncil(opportunityId: string): Promise<StoredAdvisorSession>;
  runRedTeam(opportunityId: string): Promise<StoredRedTeamReview>;
  approveOpportunity(opportunityId: string, toStatus: Opportunity["status"], rationale?: string): Promise<StoredDecision>;
  rejectOpportunity(opportunityId: string, rationale?: string): Promise<StoredDecision>;
  holdOpportunity(opportunityId: string, rationale?: string): Promise<StoredDecision>;
  watchOpportunity(opportunityId: string, rationale?: string): Promise<StoredDecision>;
  createExperiment(opportunityId: string, draft: ExperimentDraft): Promise<Experiment>;
  generatePoCSpec(opportunityId: string): Promise<StoredReport>;
  exportClaudeCode(opportunityId: string): Promise<StoredReport>;
}
