import type { AppContext } from "@/application/context";
import { COMPLIANCE_STATUSES, evaluateConnectorGate, effectiveComplianceStatus } from "@/domain/compliance/compliance";
import { can } from "@/domain/auth/authorization";
import { authorize } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";
import { connectorReadiness } from "@/application/connectors/readiness";

/** Read models for the UI. Pages call these; they never query storage directly. */

export async function getDashboard(ctx: AppContext) {
  authorize(ctx.actor, "research.read");
  const now = ctx.clock.now();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [runs, opportunities, signals, monthSpend, budget] = await Promise.all([
    ctx.repos.research.listRuns({ limit: 5 }),
    ctx.repos.opportunities.listOpportunities({ limit: 50 }),
    ctx.repos.signals.listSignals({ limit: 200 }),
    ctx.repos.ops.spendSince(monthStart),
    ctx.repos.ops.getBudget(),
  ]);
  const dayAgo = now.getTime() - 86_400_000;
  return {
    recentRuns: runs,
    topOpportunities: opportunities.slice(0, 5),
    pendingDecisions: opportunities.filter((o) => o.status === "EXPERIMENT_PROPOSED" || o.status === "POC_PROPOSED"),
    todaySignals: signals.filter((s) => Date.parse(s.createdAt) >= dayAgo).slice(0, 5),
    paySignals: signals.filter((s) => s.signalType === "PAY_SIGNAL" || s.willingnessToPayScore >= 60).slice(0, 5),
    fastRising: [...opportunities].filter((o) => o.momentum > 0).sort((a, b) => b.momentum - a.momentum).slice(0, 3),
    monthSpend,
    budget,
  };
}

export async function getRunDetail(ctx: AppContext, runId: string) {
  authorize(ctx.actor, "research.read");
  const run = await ctx.repos.research.getRun(runId);
  if (!run) throw new DomainError("NOT_FOUND", "Research run not found");
  const [directive, connectorRuns, clusters, opportunities, agentRuns, evidence, sourceItems, signals, jobs] = await Promise.all([
    ctx.repos.research.getDirective(run.directiveId),
    ctx.repos.ops.listConnectorRuns(runId),
    ctx.repos.signals.listClusters({ runId }),
    ctx.repos.opportunities.listOpportunities({ runId }),
    ctx.repos.ops.listAgentRuns({ runId }),
    ctx.repos.evidence.listEvidence({ runId }),
    ctx.repos.evidence.listSourceItems(runId),
    ctx.repos.signals.listSignals({ runId, limit: 200 }),
    ctx.repos.jobs.list({ researchRunId: runId, limit: 20 }),
  ]);
  const queued = jobs.filter((j) => j.status === "QUEUED" || j.status === "RETRYING");
  const oldestQueued = queued.length ? Math.min(...queued.map((j) => Date.parse(j.availableAt))) : null;
  const errors = [
    ...connectorRuns.filter((c) => c.status === "FAILED" || c.status === "PARTIAL").map((c) => `${c.connectorKey}: ${c.error ?? c.status}`),
    ...agentRuns.filter((a) => a.status === "FAILED" || a.status === "SKIPPED_BUDGET").map((a) => `${a.agentName}: ${a.error ?? a.status}`),
  ];
  return {
    run,
    directive,
    connectorRuns,
    clusters,
    opportunities,
    agentRuns,
    runningAgents: agentRuns.filter((a) => a.status === "RUNNING"),
    evidenceCount: evidence.length,
    sourceItems: sourceItems.slice(0, 50),
    sourceItemCount: sourceItems.length,
    signals,
    estimatedCostUsd: run.costUsd,
    errors,
    jobs: [...jobs].reverse(),
    /** Seconds the oldest ready job has waited for a worker (null = none waiting). */
    queueWaitSeconds: oldestQueued === null ? null : Math.max(0, (ctx.clock.now().getTime() - oldestQueued) / 1000),
  };
}

export async function getOpportunityDetail(ctx: AppContext, opportunityId: string) {
  authorize(ctx.actor, "research.read");
  const opportunity = await ctx.repos.opportunities.getOpportunity(opportunityId);
  if (!opportunity) throw new DomainError("NOT_FOUND", "Opportunity not found");
  const evidenceIds = await ctx.repos.opportunities.listOpportunityEvidenceIds(opportunityId);
  const [council, reports, feedback] = await Promise.all([
    ctx.repos.executive.listAdvisorSessions(opportunityId),
    ctx.repos.executive.listReports({ opportunityId, limit: 10 }),
    ctx.repos.executive.listFeedback(opportunityId),
  ]);
  const [evidence, score, redTeam, decisions, cluster, relatedRuns, competitors, marketEstimates, businessModels, experiments] = await Promise.all([
    ctx.repos.evidence.listEvidence({ ids: evidenceIds }),
    ctx.repos.opportunities.latestScore(opportunityId),
    ctx.repos.opportunities.listRedTeam(opportunityId),
    ctx.repos.opportunities.listDecisions(opportunityId),
    ctx.repos.signals.getCluster(opportunity.clusterId),
    ctx.repos.research.listRuns({ opportunityId }),
    ctx.repos.analysis.listCompetitors(opportunityId),
    ctx.repos.analysis.listMarketEstimates(opportunityId),
    ctx.repos.analysis.listBusinessModels(opportunityId),
    ctx.repos.analysis.listExperiments({ opportunityId }),
  ]);
  const runIds = [...new Set(evidence.map((e) => e.researchRunId))];
  const sourceItems = (await Promise.all(runIds.map((r) => ctx.repos.evidence.listSourceItems(r)))).flat();
  const sourceById = new Map(sourceItems.map((s) => [s.id, s]));
  return {
    opportunity,
    evidence: evidence.map((e) => ({ ...e, source: sourceById.get(e.sourceItemId) })),
    score,
    redTeam,
    decisions,
    cluster,
    relatedRuns,
    competitors,
    marketEstimates,
    businessModels,
    experiments,
    council: council[0] ?? null,
    reports,
    feedback,
    canDecide: can(ctx.actor, "opportunity.decide"),
    canAnalyze: can(ctx.actor, "analysis.run"),
  };
}

export async function listConnectorStatus(ctx: AppContext) {
  authorize(ctx.actor, "research.read");
  const settings = new Map((await ctx.repos.ops.getConnectorSettings()).map((s) => [s.connectorKey, s]));
  const recent = await ctx.repos.ops.listRecentConnectorRuns(1000);
  const now = ctx.clock.now();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  // Only names are inspected (never values); the page never shows secrets.
  const env = (name: string) => process.env[name];
  return Promise.all(
    ctx.connectors.list().map(async (c) => {
      const profile = c.complianceStatus();
      const setting = settings.get(c.id);
      const enabled = setting?.enabled ?? c.enabledByDefault;
      const gate = evaluateConnectorGate({
        profile,
        orgStatus: setting?.complianceStatus,
        enabled,
        credentialsPresent: c.credentialsPresent(),
        credentialsRequired: c.credentialsRequired,
      });
      const runs = recent.filter((r) => r.connectorKey === c.id);
      const today = runs.filter((r) => Date.parse(r.startedAt) >= dayStart && r.status !== "SKIPPED");
      const lastSuccess = runs.find((r) => r.status === "SUCCESS" || r.status === "PARTIAL");
      const lastError = runs.find((r) => r.status === "FAILED" || (r.status === "PARTIAL" && r.error));
      const readiness = await connectorReadiness(c, { env, setting, live: false });
      return {
        id: c.id,
        name: c.name,
        category: c.category,
        description: c.description,
        mode: readiness.mode,
        readiness: readiness.readiness,
        missingEnv: readiness.missingEnv,
        compliance: effectiveComplianceStatus(profile.status, setting?.complianceStatus),
        profile,
        enabled,
        credentialsRequired: c.credentialsRequired,
        credentialsPresent: c.credentialsPresent(),
        env: c.env.map((e) => ({ name: e.name, description: e.description, secret: e.secret })),
        health: await c.healthCheck(),
        runnable: gate.allowed,
        blockedReason: gate.allowed ? null : gate.message,
        lastSuccessAt: lastSuccess?.completedAt ?? null,
        lastError: lastError ? { at: lastError.completedAt, message: lastError.error ?? lastError.status } : null,
        /** External requests today (each attempt incl. retries). */
        requestsToday: today.reduce((n, r) => n + 1 + r.retryCount, 0),
        costTodayUsd: today.reduce((n, r) => n + (r.costUsd ?? 0), 0),
        termsNotes: setting?.termsNotes ?? null,
        /** Statuses an admin may choose: equal to or stricter than the code profile. */
        allowedStatuses: COMPLIANCE_STATUSES.filter((st) => effectiveComplianceStatus(profile.status, st) === st),
        canConfigure: can(ctx.actor, "connector.configure"),
      };
    }),
  );
}

export async function getCostSummary(ctx: AppContext) {
  authorize(ctx.actor, "research.read");
  const now = ctx.clock.now();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [daily, monthly, budget, runs, agentRuns] = await Promise.all([
    ctx.repos.ops.spendSince(day),
    ctx.repos.ops.spendSince(month),
    ctx.repos.ops.getBudget(),
    ctx.repos.research.listRuns({ limit: 20 }),
    ctx.repos.ops.listAgentRuns({ limit: 50 }),
  ]);
  return { daily, monthly, budget, runs, agentRuns };
}

export async function getObservability(ctx: AppContext) {
  authorize(ctx.actor, "research.read");
  const [connectorRuns, agentRuns, jobs, deadLetters] = await Promise.all([
    ctx.repos.ops.listRecentConnectorRuns(50),
    ctx.repos.ops.listAgentRuns({ limit: 50 }),
    ctx.repos.jobs.list({ limit: 30 }),
    ctx.repos.jobs.list({ deadLetteredOnly: true, limit: 30 }),
  ]);
  return { connectorRuns, agentRuns, jobs, deadLetters, canManageJobs: can(ctx.actor, "job.manage") };
}

export async function getFridayCenter(ctx: AppContext, opportunityId?: string) {
  authorize(ctx.actor, "research.read");
  const [opportunities, runs] = await Promise.all([
    ctx.repos.opportunities.listOpportunities({ limit: 100 }),
    ctx.repos.research.listRuns({ limit: 10 }),
  ]);
  const selected = opportunityId ? (opportunities.find((o) => o.id === opportunityId) ?? null) : null;
  const [council, decisions] = selected
    ? await Promise.all([ctx.repos.executive.listAdvisorSessions(selected.id), ctx.repos.opportunities.listDecisions(selected.id)])
    : [[], []];
  return {
    opportunities,
    selected,
    council: council[0] ?? null,
    decisions,
    pendingDecisions: opportunities.filter((o) => o.status === "EXPERIMENT_PROPOSED" || o.status === "POC_PROPOSED"),
    activeRuns: runs.filter((r) => !["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"].includes(r.status)),
    recentRuns: runs.slice(0, 5),
    canCeoApprove: can(ctx.actor, "opportunity.ceo_approve"),
  };
}

export async function getWatchCenter(ctx: AppContext) {
  authorize(ctx.actor, "research.read");
  const [watchlists, notifications, opportunities] = await Promise.all([
    ctx.repos.executive.listWatchlists({ activeOnly: true, mineOnly: true }),
    ctx.repos.executive.listNotifications({ limit: 50 }),
    ctx.repos.opportunities.listOpportunities({ limit: 100 }),
  ]);
  return { watchlists, notifications, opportunities };
}
