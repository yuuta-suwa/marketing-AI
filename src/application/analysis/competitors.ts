import { AgentRunner } from "@/application/agent-runner";
import { createBudgetTracker } from "@/application/budget";
import type { AppContext } from "@/application/context";
import { requestReassessment } from "@/application/opportunity/reassess";
import type { StoredCompetitor } from "@/application/ports/repositories";
import { COMPETITOR_ANALYST, analyzeCompetitorsHeuristically, analyzeCompetitorsWithLLM, type CompetitorFinding } from "@/agents/competitor-analyst";
import { authorize } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";

async function opportunityContext(ctx: AppContext, opportunityId: string) {
  const opp = await ctx.repos.opportunities.getOpportunity(opportunityId);
  if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
  const evidenceIds = await ctx.repos.opportunities.listOpportunityEvidenceIds(opportunityId);
  const evidence = await ctx.repos.evidence.listEvidence({ ids: evidenceIds });
  const runIds = [...new Set(evidence.map((e) => e.researchRunId))];
  const signals = (await Promise.all(runIds.map((runId) => ctx.repos.signals.listSignals({ runId })))).flat()
    .filter((s) => s.evidenceIds.some((id) => evidenceIds.includes(id)));
  return { opp, evidence, signals };
}

/** CompetitorAnalystAgent over all evidence linked to the opportunity. */
export async function analyzeCompetitors(ctx: AppContext, opportunityId: string): Promise<StoredCompetitor[]> {
  authorize(ctx.actor, "analysis.run");
  const { opp, evidence, signals } = await opportunityContext(ctx, opportunityId);
  const runner = new AgentRunner({ ops: ctx.repos.ops, budget: await createBudgetTracker(ctx), logger: ctx.logger, maxCallsPerAgent: 1 });
  let findings: CompetitorFinding[] | null = null;
  if (ctx.ai?.isLLM) {
    const ai = ctx.ai;
    const out = await runner.run({
      agentName: COMPETITOR_ANALYST,
      provider: ai.id,
      model: ai.model,
      input: { opportunityId },
      estimateUsd: ai.estimateCost(evidence.reduce((n, e) => n + e.evidenceText.length, 1000), 3000),
      opportunityId,
      execute: async () => {
        const r = await analyzeCompetitorsWithLLM(ai, opp, evidence);
        return { output: r.findings, ...r.llm };
      },
    });
    if (out.status === "SUCCEEDED") findings = out.output;
  }
  if (!findings) {
    const out = await runner.run({
      agentName: `${COMPETITOR_ANALYST}:heuristic`,
      provider: "heuristic",
      model: "competitor-v1",
      input: { opportunityId },
      estimateUsd: 0,
      opportunityId,
      execute: async () => ({ output: analyzeCompetitorsHeuristically(signals, evidence), usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, provider: "heuristic", model: "competitor-v1" }),
    });
    findings = out.status === "SUCCEEDED" ? out.output : [];
  }
  const saved = await ctx.repos.analysis.replaceCompetitors(
    opportunityId,
    findings.map((f) => ({ ...f, epistemicStatus: f.epistemicStatus === "FACT" ? "FACT" : "INFERENCE" })),
    { keepManual: true },
  );
  const summary = saved.length
    ? `${saved.length}件の競合・代替手段（${saved.map((c) => c.name).slice(0, 5).join("、")}${saved.length > 5 ? "…" : ""}）。Evidence由来のみ。`
    : "Evidence内に競合・代替手段の言及なし（競合調査で追加収集を推奨）";
  await ctx.repos.opportunities.updateAssessment(opportunityId, { competitorsSummary: summary, fieldProvenance: { competitorsSummary: "INFERENCE" } });
  await ctx.repos.ops.audit("analysis.competitors", "opportunity", opportunityId, { count: saved.length });
  return saved;
}

/** A user-entered competitor is an ASSUMPTION unless it cites evidence. */
export async function addManualCompetitor(
  ctx: AppContext,
  opportunityId: string,
  input: { name: string; competitorType: StoredCompetitor["competitorType"]; url?: string; pricing?: string; positioning?: string; weaknesses?: string; evidenceId?: string },
): Promise<StoredCompetitor> {
  authorize(ctx.actor, "analysis.run");
  if (input.evidenceId) {
    const linked = await ctx.repos.opportunities.listOpportunityEvidenceIds(opportunityId);
    if (!linked.includes(input.evidenceId)) throw new DomainError("EVIDENCE_INTEGRITY", "このOpportunityに紐づくEvidenceを指定してください");
  }
  const row = await ctx.repos.analysis.addCompetitor(opportunityId, {
    name: input.name,
    competitorType: input.competitorType,
    url: input.url,
    pricing: input.pricing,
    positioning: input.positioning,
    weaknesses: input.weaknesses,
    epistemicStatus: input.evidenceId ? "FACT" : "ASSUMPTION",
    sourceEvidenceIds: input.evidenceId ? [input.evidenceId] : [],
  });
  await ctx.repos.ops.audit("analysis.competitor_added", "opportunity", opportunityId, { name: input.name });
  await requestReassessment(ctx, opportunityId, "competitor added");
  return row;
}
