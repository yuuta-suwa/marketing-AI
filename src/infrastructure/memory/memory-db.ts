import type {
  AgentRunRecord,
  ConnectorRunRecord,
  ConnectorSetting,
  OrgBudget,
  StoredCluster,
  StoredDecision,
  StoredRedTeamReview,
  StoredAdvisorSession,
  StoredBusinessModel,
  StoredFeedback,
  StoredNotification,
  StoredReport,
  StoredWatchlist,
  StoredCompetitor,
  StoredMarketEstimate,
  StoredScore,
  StoredQualityReview,
} from "@/application/ports/repositories";
import type { Experiment } from "@/domain/analysis/experiment";
import type { Job } from "@/domain/jobs/job";
import type { WorkerSnapshot } from "@/domain/ops/worker-health";
import type { CostEntry } from "@/domain/cost/cost";
import type { Evidence } from "@/domain/evidence/evidence";
import type { Opportunity } from "@/domain/opportunity/opportunity";
import type { StoredResearchDirective } from "@/domain/research/directive";
import type { ResearchRun } from "@/domain/research/run";
import type { ScoringWeights } from "@/domain/scoring/criteria";
import type { StoredSignal } from "@/domain/signal/signal";
import type { SourceItem } from "@/domain/source/source-item";

type Scoped<T> = T & { organizationId: string };

/**
 * Process-local store used by unit/integration tests and DEMO mode.
 * Tenancy is enforced by the repositories (every query filters on the
 * bound organization), mirroring RLS.
 */
export class MemoryDatabase {
  directives = new Map<string, StoredResearchDirective>();
  runs = new Map<string, ResearchRun>();
  sourceItems = new Map<string, Scoped<SourceItem>>();
  evidence = new Map<string, Scoped<Evidence>>();
  signals = new Map<string, Scoped<StoredSignal>>();
  clusters = new Map<string, Scoped<StoredCluster>>();
  opportunities = new Map<string, Opportunity>();
  opportunityEvidence = new Map<string, string[]>();
  scores = new Map<string, Scoped<StoredScore>>();
  redTeam = new Map<string, Scoped<StoredRedTeamReview>>();
  decisions = new Map<string, Scoped<StoredDecision>>();
  agentRuns = new Map<string, Scoped<AgentRunRecord>>();
  connectorRuns: Array<Scoped<ConnectorRunRecord>> = [];
  costs: Array<Scoped<CostEntry & { occurredAt: string }>> = [];
  audit: Array<{ organizationId: string; actorId: string; action: string; entityType: string; entityId?: string; metadata?: Record<string, unknown>; createdAt: string }> = [];
  budgets = new Map<string, OrgBudget>();
  scoring = new Map<string, ScoringWeights>();
  connectorSettings = new Map<string, ConnectorSetting[]>();
  competitors = new Map<string, Scoped<StoredCompetitor> & { manual?: boolean }>();
  marketEstimates = new Map<string, Scoped<StoredMarketEstimate>>();
  businessModels = new Map<string, Scoped<StoredBusinessModel>>();
  experiments = new Map<string, Scoped<Experiment>>();
  opportunityEvidenceSource = new Map<string, string>();
  advisorSessions = new Map<string, Scoped<StoredAdvisorSession>>();
  reports = new Map<string, Scoped<StoredReport>>();
  watchlists = new Map<string, StoredWatchlist>();
  notifications = new Map<string, Scoped<StoredNotification> & { dedupeKey?: string }>();
  rateLimits = new Map<string, number[]>();
  feedback = new Map<string, Scoped<StoredFeedback>>();
  jobs = new Map<string, Job>();
  /** Platform operators (worker health); not derived from organization roles. */
  platformOperators = new Set<string>();
  qualityReviews = new Map<string, Scoped<StoredQualityReview>>();
  workers = new Map<string, WorkerSnapshot & { currentJobId: string | null }>();
  /** Membership directory for system contexts (worker re-checks access). */
  members = new Map<string, Map<string, "viewer" | "member" | "admin" | "owner">>();
}
