import type { AppContext } from "@/application/context";
import { startAdditionalResearch } from "@/application/opportunity/additional-research";
import { decideOpportunity } from "@/application/opportunity/decide";
import { runRedTeam } from "@/application/opportunity/red-team";
import { createResearch, toManualItems } from "@/application/research/create-research";
import { dispatchResearch } from "@/application/research/dispatch";
import { authorize } from "@/domain/auth/authorization";
import { allowedNextStatuses } from "@/domain/opportunity/status";
import { interpretScoreAndConfidence } from "@/domain/scoring/confidence";
import { CRITERION_LABEL_JA } from "@/domain/scoring/criteria";
import { DomainError } from "@/domain/shared/errors";
import { createExperiment } from "@/application/analysis/experiments";
import type { ExperimentDraft } from "@/domain/analysis/experiment";
import { openAdvisorCouncil } from "./council";
import { exportClaudeCodePrompt, generatePocSpecReport } from "./poc";
import type { ExecutiveAssistantAdapter, ExecutiveBriefing } from "./executive-assistant";

export class LocalFridayAdapter implements ExecutiveAssistantAdapter {
  constructor(private readonly ctx: AppContext) {}

  /** Every FRIDAY action is audited (actor is the signed-in human). */
  private audit(action: string, entityId?: string, metadata?: Record<string, unknown>) {
    return this.ctx.repos.ops.audit(`friday.${action}`, entityId ? "opportunity" : "friday", entityId, metadata);
  }

  async sendDirective(request: Parameters<ExecutiveAssistantAdapter["sendDirective"]>[0]) {
    const { run } = await createResearch(this.ctx, request);
    await this.audit("send_directive", undefined, { runId: run.id });
    return dispatchResearch(this.ctx, run.id, { manualItems: toManualItems(request.manualItems) });
  }

  async requestDeepResearch(opportunityId: string, type: Parameters<ExecutiveAssistantAdapter["requestDeepResearch"]>[1], note?: string) {
    await this.audit("request_deep_research", opportunityId, { type });
    return startAdditionalResearch(this.ctx, { opportunityId, type, note });
  }

  async consult(opportunityId: string): Promise<ExecutiveBriefing> {
    authorize(this.ctx.actor, "research.read");
    const repo = this.ctx.repos.opportunities;
    const opp = await repo.getOpportunity(opportunityId);
    if (!opp) throw new DomainError("NOT_FOUND", "Opportunity not found");
    const [score, evidenceIds, reviews] = await Promise.all([
      repo.latestScore(opportunityId),
      repo.listOpportunityEvidenceIds(opportunityId),
      repo.listRedTeam(opportunityId),
    ]);
    const latestReview = reviews[0] ?? null;
    await this.audit("consult", opportunityId);
    const unknowns = score ? score.score.missing.map((c) => `${CRITERION_LABEL_JA[c]}（未評価）`) : [];
    const total = opp.scoreTotal;

    let next: string;
    if (!latestReview) next = "Red Teamを実行して反証を確認する";
    else if (latestReview.verdict === "STOP") next = "撤退または保留を検討する（Red TeamがSTOP判定）";
    else if (opp.confidence === "LOW") next = "証拠を増やす：追加調査（支払意思・競合）を実行する";
    else next = opp.nextExperiment ?? "顧客インタビューで仮説を検証する";

    return {
      opportunityId,
      headline: opp.title,
      score: total,
      confidence: opp.confidence,
      interpretation: total == null ? "未スコア" : interpretScoreAndConfidence(total, opp.confidence),
      evidenceCount: evidenceIds.length,
      redTeamVerdict: latestReview?.verdict ?? null,
      mainRisk: opp.mainRisk ?? null,
      unknowns,
      recommendedNextAction: next,
      availableActions: allowedNextStatuses(opp.status).map((s) => s),
    };
  }

  async openAdvisorCouncil(opportunityId: string) {
    return openAdvisorCouncil(this.ctx, opportunityId);
  }

  async runRedTeam(opportunityId: string) {
    await this.audit("run_red_team", opportunityId);
    return runRedTeam(this.ctx, opportunityId);
  }

  async approveOpportunity(opportunityId: string, toStatus: Parameters<ExecutiveAssistantAdapter["approveOpportunity"]>[1], rationale?: string) {
    await this.audit("approve", opportunityId, { toStatus });
    return (await decideOpportunity(this.ctx, { opportunityId, decision: "APPROVE", toStatus, rationale, source: "FRIDAY" })).decision;
  }

  async rejectOpportunity(opportunityId: string, rationale?: string) {
    await this.audit("reject", opportunityId);
    return (await decideOpportunity(this.ctx, { opportunityId, decision: "REJECT", rationale, source: "FRIDAY" })).decision;
  }

  async holdOpportunity(opportunityId: string, rationale?: string) {
    await this.audit("hold", opportunityId);
    return (await decideOpportunity(this.ctx, { opportunityId, decision: "HOLD", rationale, source: "FRIDAY" })).decision;
  }

  async watchOpportunity(opportunityId: string, rationale?: string) {
    await this.audit("watch", opportunityId);
    return (await decideOpportunity(this.ctx, { opportunityId, decision: "WATCH", rationale, source: "FRIDAY" })).decision;
  }

  async createExperiment(opportunityId: string, draft: ExperimentDraft) {
    await this.audit("create_experiment", opportunityId);
    return createExperiment(this.ctx, opportunityId, draft);
  }

  async generatePoCSpec(opportunityId: string) {
    return generatePocSpecReport(this.ctx, opportunityId);
  }

  async exportClaudeCode(opportunityId: string) {
    return exportClaudeCodePrompt(this.ctx, opportunityId);
  }
}
