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
  getConnectorSettings(): Promise<ConnectorSetting[]>;
  /** Admin: enable/disable a connector or make its compliance status stricter. */
  upsertConnectorSetting(input: ConnectorSetting & { displayName: string; termsNotes?: string }): Promise<void>;
  audit(action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>): Promise<void>;
}

export type Repositories = {
  research: ResearchRepository;
  evidence: EvidenceRepository;
  signals: SignalRepository;
  opportunities: OpportunityRepository;
  ops: OpsRepository;
};
