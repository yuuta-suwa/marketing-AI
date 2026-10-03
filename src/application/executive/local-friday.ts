import type { AppContext } from "@/application/context";
import { startAdditionalResearch } from "@/application/opportunity/additional-research";
import { decideOpportunity } from "@/application/opportunity/decide";
import { runRedTeam } from "@/application/opportunity/red-team";
import { createResearch, toManualItems } from "@/application/research/create-research";
import { runResearchPipeline } from "@/application/research/pipeline";
import { authorize } from "@/domain/auth/authorization";
import { allowedNextStatuses } from "@/domain/opportunity/status";
import { interpretScoreAndConfidence } from "@/domain/scoring/confidence";
import { CRITERION_LABEL_JA } from "@/domain/scoring/criteria";
import { DomainError } from "@/domain/shared/errors";
import type { ExecutiveAssistantAdapter, ExecutiveBriefing } from "./executive-assistant";

const PLANNED = (feature: string, milestone: string) => ({
  status: "NOT_AVAILABLE" as const,
  message: `${feature}は ${milestone} で実装予定です`,
});

export class LocalFridayAdapter implements ExecutiveAssistantAdapter {
  constructor(private readonly ctx: AppContext) {}

  async sendDirective(request: Parameters<ExecutiveAssistantAdapter["sendDirective"]>[0]) {
    const { run } = await createResearch(this.ctx, request);
    return runResearchPipeline(this.ctx, run.id, { manualItems: toManualItems(request.manualItems) });
  }

  requestDeepResearch(opportunityId: string, type: Parameters<ExecutiveAssistantAdapter["requestDeepResearch"]>[1], note?: string) {
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

  async openAdvisorCouncil() {
    return PLANNED("顧問会議（Advisor Council）", "Milestone 3 (Phase 6)");
  }

  runRedTeam(opportunityId: string) {
    return runRedTeam(this.ctx, opportunityId);
  }

  async approveOpportunity(opportunityId: string, toStatus: Parameters<ExecutiveAssistantAdapter["approveOpportunity"]>[1], rationale?: string) {
    return (await decideOpportunity(this.ctx, { opportunityId, decision: "APPROVE", toStatus, rationale })).decision;
  }

  async rejectOpportunity(opportunityId: string, rationale?: string) {
    return (await decideOpportunity(this.ctx, { opportunityId, decision: "REJECT", rationale })).decision;
  }

  async holdOpportunity(opportunityId: string, rationale?: string) {
    return (await decideOpportunity(this.ctx, { opportunityId, decision: "HOLD", rationale })).decision;
  }

  async watchOpportunity(opportunityId: string, rationale?: string) {
    return (await decideOpportunity(this.ctx, { opportunityId, decision: "WATCH", rationale })).decision;
  }

  async createExperiment() {
    return PLANNED("実験作成", "Milestone 4 (Phase 8)");
  }

  async generatePoCSpec() {
    return PLANNED("PoC仕様書生成", "Milestone 4 (Phase 8)");
  }
}
