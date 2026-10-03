import type { AIProvider, GenerateResult } from "@/domain/agent/ai-provider";
import { validateEvidenceRefs, type Evidence } from "@/domain/evidence/evidence";
import type { Opportunity } from "@/domain/opportunity/opportunity";
import {
  RED_TEAM_QUESTIONS,
  RedTeamReviewSchema,
  deriveVerdict,
  type RedTeamFinding,
  type RedTeamQuestionKey,
  type RedTeamReview,
} from "@/domain/opportunity/red-team";
import type { ConfidenceLevel } from "@/domain/shared/confidence";

export const RED_TEAM = "RedTeamAgent";

export type RedTeamContext = {
  opportunity: Opportunity;
  evidence: readonly Evidence[];
  signalTypes: string[];
  sourceCount: number;
  confidence: ConfidenceLevel;
};

type Answer = Pick<RedTeamFinding, "answer" | "severity" | "epistemic">;

/**
 * Deterministic red team: answers are derived only from what the system
 * knows (evidence counts, signal types, missing analyses). Gaps are called
 * out as gaps rather than filled with speculation.
 */
export function redTeamHeuristically(ctx: RedTeamContext): RedTeamReview {
  const pay = ctx.signalTypes.filter((t) => t === "PAY_SIGNAL").length;
  const workaround = ctx.signalTypes.filter((t) => t === "WORKAROUND").length;
  const switching = ctx.signalTypes.filter((t) => t === "SWITCHING").length;
  const n = ctx.evidence.length;
  const lowEvidence = n < 3 || ctx.confidence === "LOW";
  const singleSource = ctx.sourceCount <= 1;

  const answers: Record<RedTeamQuestionKey, Answer> = {
    why_not_buy: pay === 0
      ? { answer: "支払意思を示す証拠が0件。課題が実在しても『お金を払うほどではない』可能性が高い。", severity: "HIGH", epistemic: "INFERENCE" }
      : { answer: `支払意思の記述は${pay}件あるが、価格水準は未検証。`, severity: "MEDIUM", epistemic: "INFERENCE" },
    status_quo_enough: workaround > 0
      ? { answer: `代替行動が${workaround}件確認されており、現状の回避策で『そこそこ足りている』可能性がある。乗換コストの検証が必要。`, severity: "MEDIUM", epistemic: "INFERENCE" }
      : { answer: "現在の対処方法に関する証拠がない。既存手段で十分かどうか判断できない。", severity: "HIGH", epistemic: "ASSUMPTION" },
    cannot_beat_competitors: { answer: "競合調査が未実施。既存プレイヤーが同じ課題を既に解決している可能性を排除できない。", severity: "HIGH", epistemic: "ASSUMPTION" },
    imitation: { answer: "独自データ・ネットワーク効果などの防御要素は未特定。機能だけなら短期間で模倣される前提で考えるべき。", severity: "MEDIUM", epistemic: "HYPOTHESIS" },
    distribution: { answer: "顧客獲得チャネルが未検証。課題を抱える顧客にどこで出会うかを特定する必要がある。", severity: "HIGH", epistemic: "ASSUMPTION" },
    cac: { answer: "CAC推定の根拠データがない（CFO分析未実施）。", severity: "MEDIUM", epistemic: "ASSUMPTION" },
    gross_margin: { answer: "原価構造が未確認。人手のオペレーションが必要な場合は粗利が圧迫される。", severity: "MEDIUM", epistemic: "HYPOTHESIS" },
    ai_necessity: { answer: "AIでなければ解けない理由は示されていない。ルールベース・人手でも解決できる可能性がある。", severity: "LOW", epistemic: "HYPOTHESIS" },
    regulation: { answer: "規制調査が未実施。業法・個人情報・景表法等の該当性を確認する必要がある。", severity: "MEDIUM", epistemic: "ASSUMPTION" },
    biggest_assumption: {
      answer: singleSource
        ? "単一ソースの声が市場全体を代表しているという思い込み。"
        : "観測された不満が、支払いを伴う需要に転換するという思い込み。",
      severity: singleSource ? "HIGH" : "MEDIUM",
      epistemic: "INFERENCE",
    },
    worst_case: { answer: "顧客インタビューで課題の頻度・深刻度が低いと判明し、開発投資が回収できない。", severity: "MEDIUM", epistemic: "HYPOTHESIS" },
    exit_criteria: { answer: ctx.opportunity.killCriteria ?? "撤退条件が未定義。", severity: ctx.opportunity.killCriteria ? "LOW" : "HIGH", epistemic: "HYPOTHESIS" },
  };
  if (lowEvidence) {
    answers.biggest_assumption = {
      answer: `証拠が${n}件のみで信頼度が低い。${answers.biggest_assumption.answer}`,
      severity: "HIGH",
      epistemic: "INFERENCE",
    };
  }
  if (switching > 0) {
    answers.why_not_buy.answer += ` 一方で乗換意向が${switching}件あり、既存サービスへの不満は顕在化している。`;
  }

  const findings: RedTeamFinding[] = RED_TEAM_QUESTIONS.map((q) => ({
    key: q.key,
    question: q.ja,
    ...answers[q.key],
    evidenceIds: [],
  }));
  return RedTeamReviewSchema.parse({
    findings,
    biggestAssumption: answers.biggest_assumption.answer,
    worstCase: answers.worst_case.answer,
    killCriteria: answers.exit_criteria.answer,
    verdict: deriveVerdict(findings),
  });
}

const SYSTEM = `You are RedTeamAgent of MARKET RADAR OS. Your job is to try to kill the opportunity.
Answer each question critically, in Japanese. Hard rules:
- Cite evidence ids only from the list provided; never invent ids.
- Mark each answer's epistemic status honestly: FACT only if stated in evidence; otherwise INFERENCE, HYPOTHESIS or ASSUMPTION.
- Do not invent competitor names, prices, statistics or regulations. If unknown, say it is unknown and what must be checked.
Respond with JSON only.`;

export async function redTeamWithLLM(
  provider: AIProvider,
  ctx: RedTeamContext,
): Promise<{ review: RedTeamReview; llm: Omit<GenerateResult<unknown>, "output"> }> {
  const res = await provider.generate({
    agent: RED_TEAM,
    system: SYSTEM,
    prompt: JSON.stringify({
      questions: RED_TEAM_QUESTIONS,
      opportunity: ctx.opportunity,
      evidence: ctx.evidence.map((e) => ({ id: e.id, text: e.evidenceText })),
    }),
    schema: RedTeamReviewSchema,
    maxOutputTokens: 3000,
  });
  const known = new Set(ctx.evidence.map((e) => e.id));
  for (const f of res.output.findings) {
    const { invalid } = validateEvidenceRefs(f.evidenceIds, known);
    if (invalid.length > 0) throw new Error(`RedTeamAgent cited unknown evidence ids: ${invalid.join(", ")}`);
    if (f.epistemic === "FACT" && f.evidenceIds.length === 0) f.epistemic = "INFERENCE";
  }
  return { review: res.output, llm: { usage: res.usage, costUsd: res.costUsd, provider: res.provider, model: res.model } };
}
