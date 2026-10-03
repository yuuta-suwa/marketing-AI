import type { AgentRunRecord, ConnectorRunRecord, StoredCluster, StoredDecision, StoredRedTeamReview, StoredScore } from "@/application/ports/repositories";
import type { Evidence } from "@/domain/evidence/evidence";
import type { Opportunity } from "@/domain/opportunity/opportunity";
import type { StoredResearchDirective } from "@/domain/research/directive";
import type { ResearchRun } from "@/domain/research/run";
import type { StoredSignal } from "@/domain/signal/signal";
import type { SourceItem } from "@/domain/source/source-item";

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come from PostgREST untyped */
type Row = Record<string, any>;

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export function parseVector(v: unknown): number[] | undefined {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string" && v.startsWith("[")) return JSON.parse(v) as number[];
  return undefined;
}

export function toVectorLiteral(v: readonly number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : "0")).join(",")}]`;
}

export const mapDirective = (r: Row): StoredResearchDirective => ({
  id: r.id,
  organizationId: r.organization_id,
  rawInput: r.raw_input,
  objective: r.objective,
  countries: r.countries,
  languages: r.languages,
  personas: r.personas,
  categories: r.categories,
  keywords: r.keywords,
  negativeKeywords: r.negative_keywords,
  timeRange: r.time_range,
  sourcePreferences: r.source_preferences,
  maxItems: r.max_items,
  budgetLimitUsd: num(r.budget_limit_usd),
  deepResearch: r.deep_research,
  parser: r.parser,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export const mapRun = (r: Row): ResearchRun => ({
  id: r.id,
  organizationId: r.organization_id,
  directiveId: r.directive_id,
  parentRunId: r.parent_run_id,
  opportunityId: r.opportunity_id,
  runType: r.run_type,
  status: r.status,
  statusReason: r.status_reason,
  degraded: r.degraded,
  stats: r.stats ?? {},
  budgetLimitUsd: num(r.budget_limit_usd),
  costUsd: num(r.cost_usd),
  startedAt: r.started_at,
  completedAt: r.completed_at,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export const mapSourceItem = (r: Row): SourceItem => ({
  id: r.id,
  researchRunId: r.research_run_id,
  connectorId: r.connector_key,
  sourceType: r.source_type,
  sourceName: r.source_name,
  sourceUrl: opt(r.source_url),
  canonicalUrl: opt(r.canonical_url),
  externalId: opt(r.external_id),
  title: opt(r.title),
  body: r.body,
  language: opt(r.language),
  country: opt(r.country),
  publishedAt: opt(r.published_at),
  retrievedAt: r.retrieved_at,
  engagement: r.engagement,
  metadata: r.metadata,
  contentHash: r.content_hash,
  complianceStatus: r.compliance_status,
});

export const mapEvidence = (r: Row): Evidence => ({
  id: r.id,
  researchRunId: r.research_run_id,
  sourceItemId: r.source_item_id,
  sourceUrl: opt(r.source_url),
  evidenceText: r.evidence_text,
  evidenceSummary: opt(r.evidence_summary),
  evidenceType: r.evidence_type,
  retrievedAt: r.retrieved_at,
  confidence: r.confidence,
  language: opt(r.language),
  country: opt(r.country),
});

export const mapSignal = (r: Row): StoredSignal => ({
  id: r.id,
  researchRunId: r.research_run_id,
  persona: opt(r.persona),
  situation: opt(r.situation),
  problem: r.problem,
  desiredOutcome: opt(r.desired_outcome),
  currentAlternative: opt(r.current_alternative),
  alternativeFailure: opt(r.alternative_failure),
  urgencyScore: r.urgency_score,
  frequencySignal: r.frequency_signal,
  willingnessToPayScore: r.willingness_to_pay_score,
  switchingIntentScore: r.switching_intent_score,
  trustIssue: r.trust_issue,
  priceIssue: r.price_issue,
  accessIssue: r.access_issue,
  category: opt(r.category),
  location: opt(r.location),
  signalType: r.signal_type,
  confidence: r.confidence,
  language: opt(r.language),
  country: opt(r.country),
  extractedBy: r.extracted_by,
  embeddingModel: opt(r.embedding_model),
  evidenceIds: (r.signal_evidence ?? []).map((x: Row) => x.evidence_id),
  createdAt: r.created_at,
});

export const mapCluster = (r: Row): StoredCluster => ({
  id: r.id,
  researchRunId: r.research_run_id,
  name: r.name,
  summary: opt(r.summary),
  signalCount: r.signal_count,
  sourceCount: r.source_count,
  countries: r.countries,
  languages: r.languages,
  firstSeen: opt(r.first_seen),
  lastSeen: opt(r.last_seen),
  momentum: num(r.momentum),
  painScore: r.pain_score,
  paySignalScore: r.pay_signal_score,
  confidence: r.confidence,
  namingMethod: r.naming_method,
  signalIds: (r.cluster_signals ?? []).map((x: Row) => x.signal_id),
  createdAt: r.created_at,
});

export const OPPORTUNITY_COLUMNS: Record<string, string> = {
  customer: "customer",
  trigger: "trigger",
  situation: "situation",
  pain: "pain",
  desiredOutcome: "desired_outcome",
  currentAlternatives: "current_alternatives",
  marketGap: "market_gap",
  paySignal: "pay_signal",
  marketSizeSummary: "market_size_summary",
  competitorsSummary: "competitors_summary",
  revenueModel: "revenue_model",
  distributionStrategy: "distribution_strategy",
  moat: "moat",
  aiNecessity: "ai_necessity",
  regulatoryRisk: "regulatory_risk",
  mainRisk: "main_risk",
  nextExperiment: "next_experiment",
  killCriteria: "kill_criteria",
};

export const mapOpportunity = (r: Row): Opportunity => {
  const fields: Record<string, string | undefined> = {};
  for (const [k, col] of Object.entries(OPPORTUNITY_COLUMNS)) fields[k] = opt(r[col]);
  return {
    ...(fields as unknown as Omit<Opportunity, "pain">),
    pain: r.pain,
    id: r.id,
    organizationId: r.organization_id,
    researchRunId: r.research_run_id,
    clusterId: r.cluster_id,
    title: r.title,
    status: r.status,
    confidence: r.confidence,
    scoreTotal: r.score_total === null ? null : num(r.score_total),
    momentum: num(r.momentum),
    fieldProvenance: r.field_provenance ?? {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
};

export const mapScore = (r: Row): StoredScore => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  weights: r.weights,
  score: { total: num(r.total), components: r.components.components, coverage: r.components.coverage, missing: r.components.missing },
  confidence: r.confidence,
  confidenceBreakdown: r.confidence_breakdown,
  scoredBy: r.scored_by,
  createdAt: r.created_at,
});

export const mapRedTeam = (r: Row): StoredRedTeamReview => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  researchRunId: opt(r.research_run_id),
  findings: r.findings,
  biggestAssumption: r.biggest_assumption,
  worstCase: r.worst_case,
  killCriteria: r.kill_criteria,
  verdict: r.verdict,
  createdBy: r.created_by,
  createdAt: r.created_at,
});

export const mapDecision = (r: Row): StoredDecision => ({
  id: r.id,
  opportunityId: r.opportunity_id,
  decision: r.decision,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  rationale: opt(r.rationale),
  decidedBy: r.decided_by,
  createdAt: r.created_at,
});

export const mapAgentRun = (r: Row): AgentRunRecord => ({
  id: r.id,
  agentName: r.agent_name,
  status: r.status,
  provider: r.provider,
  model: r.model,
  researchRunId: opt(r.research_run_id),
  opportunityId: opt(r.opportunity_id),
  estimatedCost: num(r.estimated_cost),
  tokenUsage: { inputTokens: num(r.token_usage?.inputTokens), outputTokens: num(r.token_usage?.outputTokens) },
  error: opt(r.error),
  startedAt: r.started_at,
  completedAt: opt(r.completed_at),
  durationMs: opt(r.duration_ms),
});

export const mapConnectorRun = (r: Row): ConnectorRunRecord => ({
  researchRunId: r.research_run_id,
  connectorKey: r.connector_key,
  status: r.status,
  resultCount: r.result_count,
  duplicateCount: r.duplicate_count,
  durationMs: r.duration_ms,
  retryCount: r.retry_count,
  error: opt(r.error),
  startedAt: r.started_at,
  completedAt: r.completed_at,
});
