import type { AppContext } from "@/application/context";
import { checkEvidenceChain, type ChainReport } from "@/application/integrity/evidence-chain";
import { authorize } from "@/domain/auth/authorization";
import type { Evidence } from "@/domain/evidence/evidence";
import type { SourceItem } from "@/domain/source/source-item";
import { DomainError } from "@/domain/shared/errors";

/**
 * Golden Run analytics: everything is computed from what the run persisted.
 * Human-judgement KPIs stay null ("pending review") until people rate the
 * output in the review table — they are never estimated by the system.
 */

const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 1000 : null);
const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
const FRESH_DAYS = 365;
/** "Sufficient evidence" for EVIDENCE_BACKED_OPPORTUNITY_RATE (baseline definition). */
export const SUFFICIENT_EVIDENCE = { minEvidence: 3, minIndependentSources: 2 } as const;

/** Independent source identity: hostname for web data, connector+name otherwise. */
export function sourceIdentity(s: Pick<SourceItem, "sourceUrl" | "connectorId" | "sourceName">): string {
  if (s.sourceUrl) {
    try {
      return new URL(s.sourceUrl).hostname.replace(/^www\./, "");
    } catch {
      /* fall through */
    }
  }
  return `${s.connectorId}:${s.sourceName}`;
}

export type ReviewRow = {
  opportunityId: string;
  opportunity: string;
  customer: string | null;
  pain: string;
  evidenceCount: number;
  sourceDiversity: number;
  paySignal: string | null;
  opportunityScore: number | null;
  evidenceConfidence: string;
  marketSizeConfidence: string;
  mainAssumption: string | null;
  redTeamMainObjection: string | null;
  recommendedNextExperiment: string | null;
  humanRating: number | null;
  humanDecision: string;
};

export type GoldenRunMetrics = {
  runId: string;
  question: string;
  status: string;
  statusReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  connectorsUsed: string[];
  mockSources: string[];
  counts: {
    sourceItems: number;
    duplicatesRemoved: number;
    evidence: number;
    signals: number;
    clusters: number;
    opportunities: number;
    apiCalls: number;
    llmCalls: number;
    retries: number;
    connectorFailures: number;
    agentFailures: number;
  };
  errors: string[];
  partialFailures: string[];
  evidenceQuality: {
    crossSourceEvidenceRate: number | null;
    validSourceUrlRate: number | null;
    highConfidenceEvidenceRate: number | null;
    freshEvidenceRate: number | null;
    duplicateRemovalRate: number | null;
    opportunityEvidenceCoverage: number | null;
    mockSourceRate: number | null;
  };
  kpis: {
    VALID_SIGNAL_RATE: number | null;
    CROSS_SOURCE_CONFIRMATION_RATE: number | null;
    EVIDENCE_BACKED_OPPORTUNITY_RATE: number | null;
    DEEP_DIVE_RATE: number | null;
    EXPERIMENT_CONVERSION_RATE: number | null;
    COST_PER_VALID_OPPORTUNITY: number | null;
    TIME_TO_VALID_OPPORTUNITY_SECONDS: number | null;
  };
  /** Which KPIs still need human review to have a value. */
  pendingHumanReview: string[];
  cost: {
    totalUsd: number;
    byCategory: Record<string, number>;
    byProvider: Record<string, number>;
    perSourceItem: number | null;
    perSignal: number | null;
    perOpportunity: number | null;
    perValidOpportunity: number | null;
  };
  integrity: ChainReport;
  reviewTable: ReviewRow[];
};

export async function computeGoldenRunMetrics(ctx: AppContext, runId: string): Promise<GoldenRunMetrics> {
  authorize(ctx.actor, "research.read");
  const run = await ctx.repos.research.getRun(runId);
  if (!run) throw new DomainError("NOT_FOUND", "Research run not found");
  const [directive, sourceItems, evidence, signals, clusters, opportunities, connectorRuns, agentRuns, costs, reviews, integrity] = await Promise.all([
    ctx.repos.research.getDirective(run.directiveId),
    ctx.repos.evidence.listSourceItems(runId),
    ctx.repos.evidence.listEvidence({ runId }),
    ctx.repos.signals.listSignals({ runId, limit: 5000 }),
    ctx.repos.signals.listClusters({ runId, limit: 500 }),
    ctx.repos.opportunities.listOpportunities({ runId, limit: 500 }),
    ctx.repos.ops.listConnectorRuns(runId),
    ctx.repos.ops.listAgentRuns({ runId, limit: 5000 }),
    ctx.repos.ops.listCostEntries(runId),
    ctx.repos.executive.listQualityReviews(runId),
    checkEvidenceChain(ctx, { runId }),
  ]);

  const sourceById = new Map(sourceItems.map((s) => [s.id, s]));
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const now = Date.parse(run.completedAt ?? ctx.clock.now().toISOString());
  const identitiesOf = (ev: Evidence[]) => new Set(ev.map((e) => sourceById.get(e.sourceItemId)).filter((s): s is SourceItem => Boolean(s)).map(sourceIdentity));

  // Cross-source: evidence whose cluster is supported by ≥ 2 independent sources.
  const clusterOfSignal = new Map<string, string>();
  for (const c of clusters) for (const sid of c.signalIds) clusterOfSignal.set(sid, c.id);
  const clusterSources = new Map<string, Set<string>>();
  for (const s of signals) {
    const cid = clusterOfSignal.get(s.id);
    if (!cid) continue;
    const set = clusterSources.get(cid) ?? new Set<string>();
    for (const id of identitiesOf(s.evidenceIds.map((x) => evidenceById.get(x)).filter((e): e is Evidence => Boolean(e)))) set.add(id);
    clusterSources.set(cid, set);
  }
  const signalEvidence = new Set<string>();
  const crossConfirmed = new Set<string>();
  for (const s of signals) {
    const cid = clusterOfSignal.get(s.id);
    for (const id of s.evidenceIds) {
      signalEvidence.add(id);
      if (cid && (clusterSources.get(cid)?.size ?? 0) >= 2) crossConfirmed.add(id);
    }
  }

  const opportunityEvidence = await Promise.all(opportunities.map((o) => ctx.repos.opportunities.listOpportunityEvidenceIds(o.id)));
  const sufficient = opportunities.filter((_, i) => {
    const ev = opportunityEvidence[i].map((id) => evidenceById.get(id)).filter((e): e is Evidence => Boolean(e));
    return ev.length >= SUFFICIENT_EVIDENCE.minEvidence && identitiesOf(ev).size >= SUFFICIENT_EVIDENCE.minIndependentSources;
  });

  // Human review inputs.
  const signalReviews = reviews.filter((r) => r.entityType === "SIGNAL" && r.useful !== null);
  const oppReviews = new Map(reviews.filter((r) => r.entityType === "OPPORTUNITY").map((r) => [r.entityId, r]));
  const reviewedOpps = opportunities.filter((o) => oppReviews.has(o.id));
  const investigated = reviewedOpps.filter((o) => ["DEEP_DIVE", "EXPERIMENT"].includes(oppReviews.get(o.id)!.decision));
  const validOpps = reviewedOpps.filter((o) => {
    const r = oppReviews.get(o.id)!;
    return (r.rating ?? 0) >= 4 || r.decision === "DEEP_DIVE" || r.decision === "EXPERIMENT";
  });
  const experimentsByOpp = await Promise.all(investigated.map((o) => ctx.repos.analysis.listExperiments({ opportunityId: o.id })));
  const converted = investigated.filter((o, i) => oppReviews.get(o.id)!.decision === "EXPERIMENT" || experimentsByOpp[i].length > 0);

  const totalCost = Math.round(costs.reduce((n, c) => n + c.amountUsd, 0) * 1e6) / 1e6;
  const sum = (key: (c: (typeof costs)[number]) => string) =>
    costs.reduce<Record<string, number>>((acc, c) => ((acc[key(c)] = Math.round(((acc[key(c)] ?? 0) + c.amountUsd) * 1e6) / 1e6), acc), {});
  const per = (n: number) => (n > 0 ? Math.round((totalCost / n) * 1e6) / 1e6 : null);
  const startedAt = run.startedAt ?? run.createdAt;
  const firstValid = validOpps.map((o) => Date.parse(o.createdAt)).sort((a, b) => a - b)[0];

  const llmRuns = agentRuns.filter((a) => a.provider !== "heuristic");
  const pending: string[] = [];
  if (signalReviews.length === 0) pending.push("VALID_SIGNAL_RATE");
  if (reviewedOpps.length === 0) pending.push("DEEP_DIVE_RATE", "COST_PER_VALID_OPPORTUNITY", "TIME_TO_VALID_OPPORTUNITY");
  if (investigated.length === 0) pending.push("EXPERIMENT_CONVERSION_RATE");

  const reviewTable: ReviewRow[] = [];
  for (const [i, o] of opportunities.entries()) {
    const ev = opportunityEvidence[i].map((id) => evidenceById.get(id)).filter((e): e is Evidence => Boolean(e));
    const [redTeam, estimates] = await Promise.all([ctx.repos.opportunities.listRedTeam(o.id), ctx.repos.analysis.listMarketEstimates(o.id)]);
    const latest = redTeam[0];
    const objection = latest ? [...latest.findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0] : undefined;
    const review = oppReviews.get(o.id);
    reviewTable.push({
      opportunityId: o.id,
      opportunity: o.title,
      customer: o.customer ?? null,
      pain: o.pain,
      evidenceCount: ev.length,
      sourceDiversity: identitiesOf(ev).size,
      paySignal: o.paySignal ?? null,
      opportunityScore: o.scoreTotal,
      evidenceConfidence: o.confidence,
      marketSizeConfidence: estimates[0]?.confidence ?? "未推定",
      mainAssumption: latest?.biggestAssumption ?? null,
      redTeamMainObjection: objection ? `${objection.question}: ${objection.answer}` : null,
      recommendedNextExperiment: o.nextExperiment ?? null,
      humanRating: review?.rating ?? null,
      humanDecision: review?.decision ?? "NONE",
    });
  }

  const errors = [
    ...connectorRuns.filter((c) => c.status === "FAILED").map((c) => `${c.connectorKey}: ${c.error ?? "FAILED"}`),
    ...agentRuns.filter((a) => a.status === "FAILED").map((a) => `${a.agentName}: ${a.error ?? "FAILED"}`),
  ];
  const partialFailures = [
    ...connectorRuns.filter((c) => c.status === "PARTIAL" || c.status === "SKIPPED").map((c) => `${c.connectorKey}: ${c.status}${c.error ? ` — ${c.error}` : ""}`),
    ...(run.stats.limitStops ?? []),
    ...(run.stats.budgetStops ?? []),
  ];
  const duplicates = run.stats.duplicates ?? 0;

  return {
    runId,
    question: directive?.rawInput ?? "",
    status: run.status,
    statusReason: run.statusReason,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationSeconds: run.startedAt && run.completedAt ? Math.round((Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1000) : null,
    connectorsUsed: [...new Set(connectorRuns.filter((c) => c.status === "SUCCESS" || c.status === "PARTIAL").map((c) => c.connectorKey))],
    mockSources: [...new Set(sourceItems.filter((s) => s.metadata?.synthetic === true).map((s) => s.connectorId))],
    counts: {
      sourceItems: sourceItems.length,
      duplicatesRemoved: duplicates,
      evidence: evidence.length,
      signals: signals.length,
      clusters: clusters.length,
      opportunities: opportunities.length,
      apiCalls: connectorRuns.filter((c) => c.status !== "SKIPPED" && c.connectorKey !== "manual_import").reduce((n, c) => n + 1 + c.retryCount, 0) + llmRuns.length,
      llmCalls: llmRuns.length + (directive?.parser === "ai" ? 1 : 0),
      retries: connectorRuns.reduce((n, c) => n + c.retryCount, 0),
      connectorFailures: connectorRuns.filter((c) => c.status === "FAILED").length,
      agentFailures: agentRuns.filter((a) => a.status === "FAILED").length,
    },
    errors,
    partialFailures,
    evidenceQuality: {
      crossSourceEvidenceRate: ratio(crossConfirmed.size, signalEvidence.size),
      validSourceUrlRate: ratio(evidence.filter((e) => /^https?:\/\//.test(sourceById.get(e.sourceItemId)?.sourceUrl ?? "")).length, evidence.length),
      highConfidenceEvidenceRate: ratio(evidence.filter((e) => e.confidence === "HIGH").length, evidence.length),
      freshEvidenceRate: ratio(
        evidence.filter((e) => {
          const p = sourceById.get(e.sourceItemId)?.publishedAt;
          return p ? now - Date.parse(p) <= FRESH_DAYS * 86_400_000 : false;
        }).length,
        evidence.length,
      ),
      duplicateRemovalRate: ratio(duplicates, duplicates + sourceItems.length),
      opportunityEvidenceCoverage: ratio(opportunityEvidence.filter((ids) => ids.length > 0).length, opportunities.length),
      mockSourceRate: ratio(sourceItems.filter((s) => s.metadata?.synthetic === true).length, sourceItems.length),
    },
    kpis: {
      VALID_SIGNAL_RATE: ratio(signalReviews.filter((r) => r.useful).length, signalReviews.length),
      CROSS_SOURCE_CONFIRMATION_RATE: ratio(crossConfirmed.size, signalEvidence.size),
      EVIDENCE_BACKED_OPPORTUNITY_RATE: ratio(sufficient.length, opportunities.length),
      DEEP_DIVE_RATE: reviewedOpps.length ? ratio(investigated.length, opportunities.length) : null,
      EXPERIMENT_CONVERSION_RATE: ratio(converted.length, investigated.length),
      COST_PER_VALID_OPPORTUNITY: reviewedOpps.length ? per(validOpps.length) : null,
      TIME_TO_VALID_OPPORTUNITY_SECONDS: firstValid ? Math.max(0, Math.round((firstValid - Date.parse(startedAt)) / 1000)) : null,
    },
    pendingHumanReview: pending,
    cost: {
      totalUsd: totalCost,
      byCategory: sum((c) => c.category),
      byProvider: sum((c) => c.provider),
      perSourceItem: per(sourceItems.length),
      perSignal: per(signals.length),
      perOpportunity: per(opportunities.length),
      perValidOpportunity: reviewedOpps.length ? per(validOpps.length) : null,
    },
    integrity,
    reviewTable,
  };
}
