import type { CfoAnalysis, CfoInputs, InputProvenance } from "@/domain/analysis/cfo";
import type { Experiment, ExperimentDecision, ExperimentDraft, ExperimentStatus } from "@/domain/analysis/experiment";
import type { MarketEstimateResult } from "@/domain/analysis/market-size";
import type { BusinessModelType } from "@/domain/opportunity/business-model";
import type { CouncilResult } from "@/domain/executive/advisor-council";
import type { WatchSnapshot } from "@/domain/executive/change-detection";
import type { ComplianceStatus } from "@/domain/compliance/compliance";
import type { CostEntry } from "@/domain/cost/cost";
import type { Evidence, NewEvidence } from "@/domain/evidence/evidence";
import type { RedTeamReview } from "@/domain/opportunity/red-team";
import type { Opportunity, OpportunityDraft } from "@/domain/opportunity/opportunity";
import type { OpportunityStatus } from "@/domain/opportunity/status";
import type { ResearchDirective, StoredResearchDirective } from "@/domain/research/directive";
import type { ResearchRun, ResearchRunStats, ResearchRunType } from "@/domain/research/run";
import type { ResearchRunStatus } from "@/domain/research/run-state-machine";
import type { ConfidenceBreakdown } from "@/domain/scoring/confidence";
import type { ScoringWeights } from "@/domain/scoring/criteria";
import type { OpportunityScore } from "@/domain/scoring/score";
import type { ConfidenceLevel } from "@/domain/shared/confidence";
import type { MarketSignal, StoredSignal } from "@/domain/signal/signal";
import type { NewSourceItem, SourceItem } from "@/domain/source/source-item";

/**
 * Persistence ports. Implementations: in-memory (tests, demo) and Supabase
 * (production, user-scoped client so RLS applies). Every method is scoped to
 * the organization of the bound actor; implementations must not accept an
 * organization id that differs from the scope they were created with.
 */

export interface ResearchRepository {
  createDirective(input: {
    directive: ResearchDirective;
    parser: "rule" | "ai";
    parseMetadata?: Record<string, unknown>;
  }): Promise<StoredResearchDirective>;
  getDirective(id: string): Promise<StoredResearchDirective | null>;
  createRun(input: {
    directiveId: string;
    runType: ResearchRunType;
    budgetLimitUsd: number;
    parentRunId?: string;
    opportunityId?: string;
  }): Promise<ResearchRun>;
  getRun(id: string): Promise<ResearchRun | null>;
  listRuns(options?: { limit?: number; opportunityId?: string }): Promise<ResearchRun[]>;
  transitionRun(
    id: string,
    to: ResearchRunStatus,
    patch?: { statusReason?: string | null; degraded?: boolean; stats?: ResearchRunStats; costUsd?: number },
  ): Promise<ResearchRun>;
}

export interface EvidenceRepository {
  /** Inserts items; items colliding with existing (run, hash|external id) are skipped. */
  insertSourceItems(items: NewSourceItem[]): Promise<SourceItem[]>;
  listSourceItems(runId: string): Promise<SourceItem[]>;
  insertEvidence(items: NewEvidence[]): Promise<Evidence[]>;
  listEvidence(filter: { runId?: string; ids?: string[] }): Promise<Evidence[]>;
}

export type NewSignal = MarketSignal & {
  researchRunId: string;
  language?: string;
  country?: string;
  extractedBy: string;
};

export type StoredCluster = {
  id: string;
  researchRunId: string;
  name: string;
  summary?: string;
  signalCount: number;
  sourceCount: number;
  countries: string[];
  languages: string[];
  firstSeen?: string;
  lastSeen?: string;
  momentum: number;
  painScore: number;
  paySignalScore: number;
  confidence: ConfidenceLevel;
  namingMethod: "rule" | "ai";
  signalIds: string[];
  createdAt: string;
};

export type NewCluster = Omit<StoredCluster, "id" | "createdAt"> & {
  centroid?: number[];
  similarities: Record<string, number>;
};

export interface SignalRepository {
  insertSignals(signals: NewSignal[]): Promise<StoredSignal[]>;
  setEmbeddings(rows: Array<{ id: string; embedding: number[]; model: string }>): Promise<void>;
  listSignals(filter: { runId?: string; ids?: string[]; limit?: number }): Promise<StoredSignal[]>;
  insertClusters(clusters: NewCluster[]): Promise<StoredCluster[]>;
  listClusters(filter: { runId?: string; limit?: number }): Promise<StoredCluster[]>;
  /** Signals created since a time, optionally matching text/country (monitoring). */
  countSignalsSince(filter: { since: string; query?: string; country?: string }): Promise<{ total: number; byType: Partial<Record<string, number>> }>;
  getCluster(id: string): Promise<StoredCluster | null>;
}

export type StoredScore = {
  id: string;
  opportunityId: string;
  weights: ScoringWeights;
  score: OpportunityScore;
  confidence: ConfidenceLevel;
  confidenceBreakdown: ConfidenceBreakdown;
  scoredBy: string;
  createdAt: string;
};

export type StoredRedTeamReview = RedTeamReview & {
  id: string;
  opportunityId: string;
  researchRunId?: string;
  createdBy: string;
  createdAt: string;
};

export type DecisionKind = "APPROVE" | "REJECT" | "HOLD" | "WATCH" | "REQUEST_RESEARCH";

export type StoredDecision = {
  id: string;
  opportunityId: string;
  decision: DecisionKind;
  fromStatus: OpportunityStatus | null;
  toStatus: OpportunityStatus | null;
  rationale?: string;
  /** Decision memory: what was decided (e.g. "PoC承認: 荷物預かり"). */
  subject?: string;
  source?: "UI" | "FRIDAY" | "SYSTEM";
  advisorSessionId?: string;
  decidedBy: string;
  createdAt: string;
};

export interface OpportunityRepository {
  createOpportunity(input: {
    researchRunId: string;
    clusterId: string;
    draft: OpportunityDraft;
    confidence: ConfidenceLevel;
    scoreTotal: number;
    momentum: number;
  }): Promise<Opportunity>;
  getOpportunity(id: string): Promise<Opportunity | null>;
  listOpportunities(filter?: { runId?: string; limit?: number; status?: OpportunityStatus }): Promise<Opportunity[]>;
  listOpportunityEvidenceIds(opportunityId: string): Promise<string[]>;
  saveScore(input: Omit<StoredScore, "id" | "createdAt">): Promise<StoredScore>;
  latestScore(opportunityId: string): Promise<StoredScore | null>;
  saveRedTeam(input: Omit<StoredRedTeamReview, "id" | "createdAt">): Promise<StoredRedTeamReview>;
  listRedTeam(opportunityId: string): Promise<StoredRedTeamReview[]>;
  recordDecision(input: Omit<StoredDecision, "id" | "createdAt" | "decidedBy">): Promise<StoredDecision>;
  listDecisions(opportunityId: string): Promise<StoredDecision[]>;
  setStatus(id: string, to: OpportunityStatus): Promise<Opportunity>;
  /** Adds evidence links (idempotent). */
  linkEvidence(opportunityId: string, evidenceIds: string[], sourceRunId?: string): Promise<number>;
  /** Updates derived assessment fields after new evidence or analyses. */
  updateAssessment(
    id: string,
    patch: Partial<Pick<Opportunity, "scoreTotal" | "confidence" | "competitorsSummary" | "marketSizeSummary" | "revenueModel" | "fieldProvenance">>,
  ): Promise<Opportunity>;
}

export type AgentRunRecord = {
  id: string;
  agentName: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED_BUDGET";
  provider: string;
  model: string;
  researchRunId?: string;
  opportunityId?: string;
  estimatedCost: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
  error?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
};

export type ConnectorRunRecord = {
  researchRunId: string;
  connectorKey: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED" | "PARTIAL";
  resultCount: number;
  duplicateCount: number;
  durationMs: number;
  retryCount: number;
  error?: string;
  costUsd?: number;
  startedAt: string;
  completedAt: string;
};

export type ConnectorSetting = {
  connectorKey: string;
  enabled: boolean;
  complianceStatus: ComplianceStatus;
  termsNotes?: string;
};

export type OrgBudget = { perRunUsd: number; dailyUsd: number; monthlyUsd: number };

export interface OpsRepository {
  startAgentRun(input: {
    agentName: string;
    provider: string;
    model: string;
    inputJson: unknown;
    researchRunId?: string;
    opportunityId?: string;
  }): Promise<AgentRunRecord>;
  finishAgentRun(
    id: string,
    patch: {
      status: "SUCCEEDED" | "FAILED" | "SKIPPED_BUDGET";
      outputJson?: unknown;
      error?: string;
      tokenUsage?: { inputTokens: number; outputTokens: number };
      estimatedCost?: number;
      durationMs: number;
    },
  ): Promise<void>;
  listAgentRuns(filter: { runId?: string; opportunityId?: string; limit?: number }): Promise<AgentRunRecord[]>;
  recordConnectorRun(record: ConnectorRunRecord): Promise<void>;
  listConnectorRuns(runId: string): Promise<ConnectorRunRecord[]>;
  /** Most recent connector executions across runs (observability). */
  listRecentConnectorRuns(limit?: number): Promise<ConnectorRunRecord[]>;
  recordCost(entry: CostEntry): Promise<void>;
  spendSince(since: Date): Promise<number>;
  spendByRun(runId: string): Promise<number>;
  getBudget(): Promise<OrgBudget>;
  getScoringWeights(): Promise<{ id: string | null; weights: ScoringWeights }>;
  /** Admin: replace the active scoring weights (validated to sum 100 in app and DB). */
  updateScoringWeights(weights: ScoringWeights): Promise<{ id: string | null; weights: ScoringWeights }>;
  getConnectorSettings(): Promise<ConnectorSetting[]>;
  /** Admin: enable/disable a connector or make its compliance status stricter. */
  upsertConnectorSetting(input: ConnectorSetting & { displayName: string; termsNotes?: string }): Promise<void>;
  audit(action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>): Promise<void>;
}

export type StoredCompetitor = {
  id: string;
  opportunityId: string;
  name: string;
  competitorType: "DIRECT" | "INDIRECT" | "ALTERNATIVE";
  url?: string;
  pricing?: string;
  positioning?: string;
  customerComplaints?: string;
  strengths?: string;
  weaknesses?: string;
  marketGap?: string;
  epistemicStatus: "FACT" | "INFERENCE" | "HYPOTHESIS" | "ASSUMPTION";
  sourceEvidenceIds: string[];
  createdAt: string;
};

export type StoredMarketEstimate = MarketEstimateResult & {
  id: string;
  opportunityId: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
};

export type StoredBusinessModel = {
  id: string;
  opportunityId: string;
  modelType: BusinessModelType;
  description?: string;
  fitScore: number;
  rationale?: string;
  risks?: string;
  isPrimary: boolean;
  unitEconomics: Partial<CfoAnalysis> & { inputs?: CfoInputs; provenance?: InputProvenance };
  createdBy: string;
  createdAt: string;
};

export interface AnalysisRepository {
  replaceCompetitors(opportunityId: string, rows: Array<Omit<StoredCompetitor, "id" | "createdAt" | "opportunityId">>, options?: { keepManual?: boolean }): Promise<StoredCompetitor[]>;
  addCompetitor(opportunityId: string, row: Omit<StoredCompetitor, "id" | "createdAt" | "opportunityId">): Promise<StoredCompetitor>;
  listCompetitors(opportunityId: string): Promise<StoredCompetitor[]>;
  saveMarketEstimate(opportunityId: string, estimate: MarketEstimateResult & { notes?: string; createdBy: string }): Promise<StoredMarketEstimate>;
  listMarketEstimates(opportunityId: string): Promise<StoredMarketEstimate[]>;
  replaceBusinessModels(opportunityId: string, rows: Array<Omit<StoredBusinessModel, "id" | "createdAt" | "opportunityId">>): Promise<StoredBusinessModel[]>;
  listBusinessModels(opportunityId: string): Promise<StoredBusinessModel[]>;
  setUnitEconomics(businessModelId: string, unitEconomics: StoredBusinessModel["unitEconomics"]): Promise<void>;
  createExperiment(opportunityId: string, draft: ExperimentDraft): Promise<Experiment>;
  getExperiment(id: string): Promise<Experiment | null>;
  listExperiments(filter: { opportunityId?: string; limit?: number }): Promise<Experiment[]>;
  updateExperiment(id: string, patch: { status?: ExperimentStatus; resultSummary?: string; decision?: ExperimentDecision; approve?: boolean; decide?: boolean }): Promise<Experiment>;
}

export type StoredAdvisorSession = CouncilResult & {
  id: string;
  opportunityId: string;
  status: "OPEN" | "COMPLETED" | "FAILED";
  createdAt: string;
};

export type StoredReport = {
  id: string;
  reportType: "DAILY_BRIEF" | "RESEARCH_SUMMARY" | "OPPORTUNITY" | "POC_SPEC" | "CLAUDE_CODE_PROMPT";
  title: string;
  contentMd: string;
  contentJson: Record<string, unknown>;
  opportunityId?: string;
  periodStart?: string;
  periodEnd?: string;
  createdAt: string;
};

export const WATCH_TARGETS = ["OPPORTUNITY", "COMPETITOR", "PROBLEM", "MARKET", "COUNTRY", "KEYWORD", "INDUSTRY", "PERSONA", "TECHNOLOGY", "REGULATION"] as const;
export type WatchTarget = (typeof WATCH_TARGETS)[number];

export type StoredWatchlist = {
  id: string;
  organizationId: string;
  userId: string;
  targetType: WatchTarget;
  targetId?: string;
  query?: string;
  label?: string;
  scheduleCron?: string;
  active: boolean;
  lastCheckedAt?: string;
  snapshot?: WatchSnapshot;
  createdAt: string;
};

export type StoredNotification = {
  id: string;
  userId: string;
  kind: string;
  title: string;
  body?: string;
  link?: string;
  severity: "INFO" | "IMPORTANT" | "CRITICAL";
  watchlistId?: string;
  readAt?: string;
  createdAt: string;
};

export const FEEDBACK_METRICS = ["CUSTOMER_RESPONSE", "CUSTOMER_INTERVIEW", "CONVERSION", "REVENUE", "RETENTION", "CHURN", "FEEDBACK", "LAUNCH_RESULT"] as const;
export type FeedbackMetric = (typeof FEEDBACK_METRICS)[number];

export type StoredFeedback = {
  id: string;
  opportunityId: string;
  experimentId?: string;
  metric: FeedbackMetric;
  value?: number;
  unit?: string;
  note?: string;
  occurredAt: string;
  recordedBy: string;
};

export type LineageRow = {
  opportunityId: string;
  title: string;
  status: OpportunityStatus;
  scoreTotal: number | null;
  confidence: ConfidenceLevel;
  signalCount: number;
  evidenceCount: number;
  experimentCount: number;
  experimentsPositive: number;
  revenueTotal: number;
  feedbackCount: number;
};

export interface ExecutiveRepository {
  saveAdvisorSession(opportunityId: string, result: CouncilResult): Promise<StoredAdvisorSession>;
  listAdvisorSessions(opportunityId: string): Promise<StoredAdvisorSession[]>;
  saveReport(input: Omit<StoredReport, "id" | "createdAt">): Promise<StoredReport>;
  getReport(id: string): Promise<StoredReport | null>;
  listReports(filter: { type?: StoredReport["reportType"]; opportunityId?: string; limit?: number }): Promise<StoredReport[]>;
  createWatchlist(input: { targetType: WatchTarget; targetId?: string; query?: string; label?: string; scheduleCron?: string }): Promise<StoredWatchlist>;
  listWatchlists(filter?: { activeOnly?: boolean; mineOnly?: boolean }): Promise<StoredWatchlist[]>;
  updateWatchlist(id: string, patch: { active?: boolean; snapshot?: WatchSnapshot; lastCheckedAt?: string }): Promise<void>;
  /** Returns false when the dedupe key already exists (no duplicate notification). */
  createNotification(input: Omit<StoredNotification, "id" | "createdAt" | "readAt"> & { dedupeKey?: string }): Promise<boolean>;
  listNotifications(filter?: { unreadOnly?: boolean; limit?: number }): Promise<StoredNotification[]>;
  markNotificationRead(id: string): Promise<void>;
  recordFeedback(input: Omit<StoredFeedback, "id" | "recordedBy">): Promise<StoredFeedback>;
  listFeedback(opportunityId: string): Promise<StoredFeedback[]>;
  listLineage(): Promise<LineageRow[]>;
}

export type Repositories = {
  research: ResearchRepository;
  evidence: EvidenceRepository;
  signals: SignalRepository;
  opportunities: OpportunityRepository;
  ops: OpsRepository;
  analysis: AnalysisRepository;
  executive: ExecutiveRepository;
};
