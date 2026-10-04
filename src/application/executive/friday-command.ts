import type { AppContext } from "@/application/context";
import { createExperiment } from "@/application/analysis/experiments";
import { decideOpportunity } from "@/application/opportunity/decide";
import { runRedTeam } from "@/application/opportunity/red-team";
import { createResearch } from "@/application/research/create-research";
import { dispatchResearch } from "@/application/research/dispatch";
import { startAdditionalResearch } from "@/application/opportunity/additional-research";
import { parseFridayIntent } from "@/domain/executive/friday-intent";
import { nextForwardStatus, OPPORTUNITY_STATUS_LABEL_JA } from "@/domain/opportunity/status";
import { isDomainError } from "@/domain/shared/errors";
import { openAdvisorCouncil } from "./council";
import { computeDailyBrief } from "./daily-brief";
import { LocalFridayAdapter } from "./local-friday";
import { exportClaudeCodePrompt, generatePocSpecReport } from "./poc";

export type FridayReply = {
  intent: string;
  message: string;
  link?: { href: string; label: string };
};

const HELP =
  "できること: 「〜を調べて」(調査) / 「競合調査」「海外比較」「支払意思」「市場規模」「規制」(追加調査) / 「Red Team」 / 「顧問会議」 / 「どう思う？」(相談) / 「承認 理由: …」「保留」「却下」「ウォッチ」 / 「実験」 / 「PoC仕様書」 / 「Claude Codeにエクスポート」 / 「今日のブリーフ」";

/**
 * FRIDAY command routing. Conversation text is NOT stored; only decisions
 * (via decideOpportunity, source = FRIDAY) and produced artefacts persist.
 */
export async function handleFridayCommand(ctx: AppContext, input: { text: string; opportunityId?: string }): Promise<FridayReply> {
  const intent = parseFridayIntent(input.text);
  // Audit the action, not the conversation text.
  await ctx.repos.ops.audit(`friday.command`, input.opportunityId ? "opportunity" : "friday", input.opportunityId, { intent: intent.kind });
  const needOpp = (): string => {
    if (!input.opportunityId) throw Object.assign(new Error("NEED_CONTEXT"), { needContext: true });
    return input.opportunityId;
  };
  try {
    switch (intent.kind) {
      case "HELP":
        return { intent: intent.kind, message: HELP };
      case "RESEARCH": {
        const { run } = await createResearch(ctx, { input: intent.query });
        await dispatchResearch(ctx, run.id);
        return {
          intent: intent.kind,
          message: "調査をキューに登録しました。バックグラウンドで収集 → Evidence → Signal → Opportunity まで進めます。",
          link: { href: `/research/runs/${run.id}`, label: "進捗を見る" },
        };
      }
      case "DEEP_RESEARCH": {
        const id = needOpp();
        const dispatched = await startAdditionalResearch(ctx, { opportunityId: id, type: intent.type });
        return {
          intent: intent.kind,
          message: `追加調査（${intent.type}）をキューに登録しました。結果はこの事業機会に反映されます。`,
          link: { href: `/research/runs/${dispatched.runId}`, label: "進捗を見る" },
        };
      }
      case "RED_TEAM": {
        const r = await runRedTeam(ctx, needOpp());
        return { intent: intent.kind, message: `Red Team判定: ${r.verdict}。最大の思い込み: ${r.biggestAssumption}`, link: { href: `/opportunities/${input.opportunityId}#red-team`, label: "詳細" } };
      }
      case "COUNCIL": {
        const s = await openAdvisorCouncil(ctx, needOpp());
        return { intent: intent.kind, message: `顧問会議: ${s.consensus} 未解決の問い ${s.unansweredQuestions.length}件・必要な証拠 ${s.requiredEvidence.length}件。最終判断はあなたです。`, link: { href: `/friday?opportunity=${input.opportunityId}#council`, label: "会議の結果" } };
      }
      case "CONSULT": {
        const b = await new LocalFridayAdapter(ctx).consult(needOpp());
        return { intent: intent.kind, message: `${b.headline}: ${b.interpretation}（スコア ${b.score ?? "—"} / 証拠 ${b.confidence}）。推奨: ${b.recommendedNextAction}` };
      }
      case "APPROVE": {
        const id = needOpp();
        const opp = await ctx.repos.opportunities.getOpportunity(id);
        const to = opp ? nextForwardStatus(opp.status) : null;
        if (!opp || !to) return { intent: intent.kind, message: "この状態からは承認で進める先がありません。" };
        await decideOpportunity(ctx, { opportunityId: id, decision: "APPROVE", toStatus: to, rationale: intent.reason, source: "FRIDAY", subject: `${OPPORTUNITY_STATUS_LABEL_JA[to]}: ${opp.title}` });
        return { intent: intent.kind, message: `承認を記録しました: ${OPPORTUNITY_STATUS_LABEL_JA[opp.status]} → ${OPPORTUNITY_STATUS_LABEL_JA[to]}${intent.reason ? `（理由: ${intent.reason}）` : ""}` };
      }
      case "REJECT":
      case "HOLD":
      case "WATCH": {
        const id = needOpp();
        const { opportunity } = await decideOpportunity(ctx, { opportunityId: id, decision: intent.kind, rationale: "reason" in intent ? intent.reason : undefined, source: "FRIDAY" });
        return { intent: intent.kind, message: `判断を記録しました（${intent.kind} → ${OPPORTUNITY_STATUS_LABEL_JA[opportunity.status]}）` };
      }
      case "EXPERIMENT": {
        const id = needOpp();
        const opp = await ctx.repos.opportunities.getOpportunity(id);
        const deadline = new Date(ctx.clock.now().getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
        const exp = await createExperiment(ctx, id, {
          title: `検証: ${opp?.title ?? ""}`.slice(0, 200),
          hypothesis: opp?.nextExperiment ?? "顧客は課題解消に対価を払う",
          method: "顧客インタビュー5〜10名 + 価格提示",
          metric: "支払意思を示した割合",
          target: "30%以上",
          budgetUsd: 100,
          deadline,
          killCriteria: opp?.killCriteria,
        });
        return { intent: intent.kind, message: `実験案を作成しました（${exp.status}・期限 ${deadline}）。承認は人間が行います。`, link: { href: `/opportunities/${id}`, label: "実験を確認" } };
      }
      case "POC_SPEC": {
        const r = await generatePocSpecReport(ctx, needOpp());
        return { intent: intent.kind, message: `PoC仕様書を作成しました${r.contentJson.approved ? "" : "（DRAFT：PoC未承認）"}。`, link: { href: `/reports/${r.id}`, label: "仕様書を開く" } };
      }
      case "EXPORT": {
        const r = await exportClaudeCodePrompt(ctx, needOpp());
        return { intent: intent.kind, message: "CLAUDE_CODE_BUILD_PROMPT を生成しました。新しいリポジトリで使えます。", link: { href: `/reports/${r.id}`, label: "プロンプトを開く" } };
      }
      case "BRIEF": {
        const b = await computeDailyBrief(ctx);
        return {
          intent: intent.kind,
          message: b.meaningful
            ? `直近24時間: 新規シグナル ${b.newSignals}件、強い痛み ${b.highSignalPains.length}件、支払意思 ${b.paySignals.length}件、判断待ち ${b.pendingDecisions.length}件。`
            : "直近24時間に意味のある変化はありません。",
          link: { href: "/dashboard#brief", label: "ブリーフ" },
        };
      }
    }
  } catch (e) {
    if (e instanceof Error && (e as { needContext?: boolean }).needContext) {
      return { intent: intent.kind, message: "対象の事業機会を「Current Context」で選択してください。" };
    }
    if (isDomainError(e)) return { intent: intent.kind, message: `実行できませんでした: ${e.message}` };
    throw e;
  }
}
