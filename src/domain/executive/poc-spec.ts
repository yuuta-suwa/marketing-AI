import { BUSINESS_MODEL_LABEL_JA } from "../analysis/business-model";
import { OPPORTUNITY_STATUS_LABEL_JA } from "../opportunity/status";
import type { OpportunityDossier } from "./dossier";

export const POC_SPEC_SECTIONS = [
  "Problem", "Customer", "Evidence", "Hypothesis", "Value Proposition", "Core Features", "Non Goals",
  "User Flow", "Data Model", "API Requirements", "AI Requirements", "Metrics", "Experiment",
  "Kill Criteria", "Technical Architecture", "Security", "Cost Limit", "Acceptance Criteria",
] as const;

export type PocSpec = {
  title: string;
  approved: boolean;
  sections: Record<(typeof POC_SPEC_SECTIONS)[number], string>;
  markdown: string;
};

const bullet = (xs: Array<string | undefined | null>) => xs.filter(Boolean).map((x) => `- ${x}`).join("\n") || "- （未定義）";

/**
 * Deterministic PoC specification from the dossier. Facts are quoted from
 * evidence; everything else is labelled as hypothesis/assumption. A spec for
 * an opportunity without POC approval is marked DRAFT.
 */
export function generatePocSpec(d: OpportunityDossier, options: { costLimitUsd?: number } = {}): PocSpec {
  const o = d.opportunity;
  const approved = o.status === "POC_APPROVED" || o.status === "LAUNCHED";
  const model = d.primaryModel ? BUSINESS_MODEL_LABEL_JA[d.primaryModel.modelType] : "未決定";
  const evidenceLines = d.evidence.slice(0, 8).map((e) => `「${e.evidenceText.slice(0, 140)}」${e.sourceUrl ? ` (${e.sourceUrl})` : ""} [evidence:${e.id}]`);
  const lastExperiment = d.experiments.find((x) => x.status === "COMPLETED") ?? d.experiments[0];
  const cost = options.costLimitUsd ?? 500;
  const cfo = d.cfo?.metrics;

  const sections: PocSpec["sections"] = {
    Problem: `${o.pain}\n\n（FACT: 顧客の発言から引用。Situation: ${o.situation ?? "未特定"}）`,
    Customer: `${o.customer ?? "未特定"}（${o.fieldProvenance.customer ?? "INFERENCE"}）`,
    Evidence: `${d.evidence.length}件のEvidence（信頼度 ${d.confidence?.level ?? o.confidence}）\n${bullet(evidenceLines)}`,
    Hypothesis: `HYPOTHESIS: ${o.customer ?? "対象顧客"}は「${o.pain.slice(0, 80)}」を解消する手段に対価を払う。\n支払意思: ${o.paySignal ?? "未検証"}`,
    "Value Proposition": `${o.desiredOutcome ? `顧客が望む状態: ${o.desiredOutcome}\n` : ""}現在の代替手段（${o.currentAlternatives ?? "不明"}）より速く・確実に課題を解消する。（HYPOTHESIS）`,
    "Core Features": bullet([
      `課題「${o.pain.slice(0, 50)}」を解消する最小のコア機能（1つに絞る）`,
      "利用状況の計測（Metricsに対応するイベント）",
      d.primaryModel ? `${model}の課金/計測の最小実装` : null,
    ]),
    "Non Goals": bullet(["コア課題以外の機能", "多言語・多地域展開（検証完了まで）", "本格的な管理画面", "スケール前提の最適化"]),
    "User Flow": bullet(["課題に直面する場面で流入", "コア機能で課題を解消", "結果を確認", "継続利用/支払いの意思表示"]),
    "Data Model": bullet(["users（認証）", "core_entities（解消対象の記録）", "events（計測）", "payments_or_intents（支払意思/決済）"]),
    "API Requirements": bullet(["認証API", "コア機能API（入力検証必須）", "計測イベントAPI", "外部APIは公式APIのみ・認証情報はサーバー側"]),
    "AI Requirements": `${o.aiNecessity ?? "AIの必要性は未検証"}\n${bullet(["AIを使う場合は構造化出力＋スキーマ検証", "AIなし（ルール/人手）で代替できるかを並行比較", "1ユーザーあたりAIコスト上限を設定"])}`,
    Metrics: bullet([
      lastExperiment ? `${lastExperiment.metric}（目標: ${lastExperiment.target}）` : "主要指標: 継続利用率・支払意思表明率",
      cfo?.grossMargin ? `粗利率 目標 ${Math.round(cfo.grossMargin.value * 100)}%（CALCULATION）` : null,
      cfo?.cac ? `CAC 上限 ${cfo.cac.value}（${cfo.cac.epistemic}）` : null,
    ]),
    Experiment: lastExperiment
      ? `${lastExperiment.title}: ${lastExperiment.hypothesis}\nTest: ${lastExperiment.method} / Metric: ${lastExperiment.metric} / Target: ${lastExperiment.target} / Deadline: ${lastExperiment.deadline}${lastExperiment.resultSummary ? `\nResult: ${lastExperiment.resultSummary}（${lastExperiment.decision}）` : ""}`
      : o.nextExperiment ?? "未設計",
    "Kill Criteria": o.killCriteria ?? d.redTeam?.killCriteria ?? "未定義（PoC開始前に定義すること）",
    "Technical Architecture": bullet(["Next.js (App Router) + TypeScript strict", "Supabase (Postgres + Auth + RLS)", "Zodによる入力検証", "Vitest + Playwright", "Domain/Application/Infrastructure分離"]),
    Security: bullet(["全テーブルRLS", "シークレットはサーバー環境変数のみ", "認可にuser_metadataを使わない", "監査ログ", "個人情報の最小化"]),
    "Cost Limit": `PoC予算上限 $${cost}（AI/API/インフラ合計）。月次上限を超えたらAI機能を停止。`,
    "Acceptance Criteria": bullet([
      "コア機能がモバイルで動作する",
      lastExperiment ? `${lastExperiment.metric} が ${lastExperiment.target} を達成` : "主要指標の目標値を達成",
      "Kill Criteria に該当しない",
      "セキュリティ要件（RLS・シークレット管理）を満たす",
      "自動テストとProduction buildが成功",
    ]),
  };

  const header = `# PoC Specification — ${o.title}\n\n> Status: ${OPPORTUNITY_STATUS_LABEL_JA[o.status]} ${approved ? "（PoC承認済み）" : "— DRAFT（PoC未承認：開発開始には人間の承認が必要）"}\n> Score ${o.scoreTotal ?? "—"}/100 · Confidence ${d.confidence?.level ?? o.confidence} · Business model: ${model}\n> Red Team: ${d.redTeam?.verdict ?? "未実施"}\n`;
  const markdown = [header, ...POC_SPEC_SECTIONS.map((k) => `## ${k}\n\n${sections[k]}\n`)].join("\n");
  return { title: o.title, approved, sections, markdown };
}
