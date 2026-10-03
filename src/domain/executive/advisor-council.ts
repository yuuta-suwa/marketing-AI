import type { ScoreCriterion } from "../scoring/criteria";
import type { OpportunityDossier } from "./dossier";

/**
 * Advisor Council: analytical perspectives inspired by widely published
 * decision principles. They are lenses, NOT impersonations of people —
 * no names, no quotes, no invented sayings.
 */
export const PERSPECTIVES = [
  { key: "LONG_TERM_VISION", ja: "Long-term / Vision", lens: "10年後も重要な課題か、市場が拡大する方向にあるか" },
  { key: "CUSTOMER_VALUE", ja: "Customer Value", lens: "顧客の切実な痛みを、顧客自身が価値と感じる形で解くか" },
  { key: "FIRST_PRINCIPLES", ja: "First Principles", lens: "前提を分解し、根本のコスト構造・制約から成立性を検証する" },
  { key: "EXECUTION", ja: "Execution", lens: "小さく速く検証でき、次の一手が明確か" },
  { key: "FOCUS_UX", ja: "Focus / UX", lens: "やらないことを決め、体験をシンプルにできるか" },
  { key: "CAPITAL_EFFICIENCY", ja: "Capital Efficiency", lens: "少ない資本で検証・回収できるユニットエコノミクスか" },
  { key: "PEOPLE", ja: "People", lens: "必要な能力・パートナー・運用体制を揃えられるか" },
  { key: "SOCIAL_VALUE", ja: "Mission / Social Value", lens: "社会的に良い影響があり、規制・倫理上の懸念がないか" },
] as const;
export type PerspectiveKey = (typeof PERSPECTIVES)[number]["key"];

export type Stance = "SUPPORT" | "CONCERN" | "NEUTRAL";

export type PerspectiveOpinion = {
  perspective: PerspectiveKey;
  label: string;
  lens: string;
  stance: Stance;
  opinion: string;
  concerns: string[];
  questions: string[];
  assumptions: string[];
  requiredEvidence: string[];
  epistemic: "INFERENCE";
};

export type CouncilResult = {
  perspectives: PerspectiveOpinion[];
  consensus: string;
  disagreements: Array<{ topic: string; support: string[]; concern: string[] }>;
  unansweredQuestions: string[];
  criticalAssumptions: string[];
  requiredEvidence: string[];
};

const comp = (d: OpportunityDossier, key: ScoreCriterion) => d.score?.components[key];

function opinionFor(key: PerspectiveKey, d: OpportunityDossier): Omit<PerspectiveOpinion, "perspective" | "label" | "lens" | "epistemic"> {
  const o = d.opportunity;
  const ev = d.evidence.length;
  const pain = comp(d, "painSeverity")?.appliedValue ?? 0;
  const wtp = comp(d, "willingnessToPay")?.appliedValue ?? 0;
  const gm = d.cfo?.metrics.grossMargin?.value;
  const ltvCac = d.cfo?.metrics.ltvToCac?.value;
  const payback = d.cfo?.metrics.paybackMonths?.value;
  const completed = d.experiments.filter((x) => x.status === "COMPLETED");
  const positive = completed.filter((x) => x.decision === "CONTINUE" || x.decision === "SCALE");
  const regulation = d.redTeam?.findings.find((f) => f.key === "regulation");
  const ai = d.redTeam?.findings.find((f) => f.key === "ai_necessity");

  switch (key) {
    case "LONG_TERM_VISION": {
      const momentum = o.momentum;
      return {
        stance: momentum > 20 ? "SUPPORT" : momentum < -20 ? "CONCERN" : "NEUTRAL",
        opinion: momentum !== 0 ? `シグナルのモメンタムは${momentum > 0 ? "上昇" : "下降"}（${momentum}）。` : "長期トレンドを判断できる日付付きデータが不足。",
        concerns: momentum <= 0 ? ["一時的な不満で終わる可能性"] : [],
        questions: ["この課題は5〜10年後も存在するか？", "技術・制度の変化で課題自体が消えないか？"],
        assumptions: ["観測された不満が構造的な課題である"],
        requiredEvidence: momentum === 0 ? ["期間別のシグナル推移（Watchlistで継続観測）"] : [],
      };
    }
    case "CUSTOMER_VALUE":
      return {
        stance: pain >= 0.6 && ev >= 3 ? "SUPPORT" : pain < 0.4 ? "CONCERN" : "NEUTRAL",
        opinion: `痛みの深刻度 ${Math.round(pain * 100)}/100、Evidence ${ev}件。顧客は「${o.pain.slice(0, 50)}」と述べている。`,
        concerns: [...(o.customer?.includes("未特定") ? ["顧客セグメントが未特定"] : []), ...(wtp < 0.4 ? ["支払意思の証拠が弱い"] : [])],
        questions: ["誰が最も強くこの痛みを感じているか？", "顧客は今いくら・どれだけの時間を使っているか？"],
        assumptions: ["痛みを感じる人と支払う人が一致する"],
        requiredEvidence: ["対象顧客5〜10名へのインタビュー記録", ...(wtp < 0.4 ? ["価格提示への反応（支払意思調査）"] : [])],
      };
    case "FIRST_PRINCIPLES":
      return {
        stance: d.marketEstimate && d.cfo ? "NEUTRAL" : "CONCERN",
        opinion: d.marketEstimate
          ? `市場規模は ${d.marketEstimate.formula} で算出（仮定 ${d.marketEstimate.assumptions.length}件）。`
          : "市場規模とコスト構造が未分解。前提から積み上げる必要がある。",
        concerns: d.marketEstimate && d.marketEstimate.assumptions.length > 0 ? ["市場規模が仮定値に依存"] : [],
        questions: ["顧客数・頻度・単価の各入力の根拠は何か？", "既存の代替手段のコストはいくらか？"],
        assumptions: d.marketEstimate?.assumptions.slice(0, 3) ?? ["市場規模は十分に大きい"],
        requiredEvidence: ["公的統計など顧客数の根拠（e-Stat等）"],
      };
    case "EXECUTION":
      return {
        stance: positive.length > 0 ? "SUPPORT" : d.experiments.length === 0 ? "CONCERN" : "NEUTRAL",
        opinion: d.experiments.length === 0 ? "検証実験が未設計。次の一手が不明確。" : `実験 ${d.experiments.length}件（完了 ${completed.length}、前向き判断 ${positive.length}）。`,
        concerns: d.experiments.length === 0 ? ["検証計画なし"] : [],
        questions: ["2週間以内に実行できる最小の検証は何か？"],
        assumptions: ["小規模検証で需要を判断できる"],
        requiredEvidence: ["実験結果（指標と目標値の比較）"],
      };
    case "FOCUS_UX":
      return {
        stance: d.competitors.length > 5 ? "CONCERN" : "NEUTRAL",
        opinion: `競合・代替手段 ${d.competitors.length}件。単一のコア体験に絞れるかが鍵。`,
        concerns: d.competitors.length > 5 ? ["代替手段が多く差別化が難しい"] : [],
        questions: ["最初に解く1つの場面（Situation）はどれか？", "やらないことは何か？"],
        assumptions: ["1機能で顧客の主要な痛みを解消できる"],
        requiredEvidence: ["ユーザージャーニー上の最大の摩擦点の特定"],
      };
    case "CAPITAL_EFFICIENCY": {
      if (!d.cfo) {
        return { stance: "CONCERN", opinion: "CFO分析が未実施。回収構造を判断できない。", concerns: ["ユニットエコノミクス未検証"], questions: ["CACとLTVの見込みは？"], assumptions: [], requiredEvidence: ["価格・原価・CACの根拠"] };
      }
      const good = (gm ?? 0) >= 0.6 && (ltvCac ?? 0) >= 3 && (payback ?? 99) <= 12;
      return {
        stance: good ? "SUPPORT" : "CONCERN",
        opinion: `粗利率 ${Math.round((gm ?? 0) * 100)}%、LTV/CAC ${Number.isFinite(ltvCac) ? ltvCac : "∞"}、回収 ${Number.isFinite(payback) ? payback : "∞"}ヶ月（多くは仮定入力に基づく計算）。`,
        concerns: d.cfo.warnings,
        questions: ["CACの前提はどのチャネルの実績に基づくか？"],
        assumptions: Object.entries(d.cfo.metrics).filter(([, m]) => m.epistemic === "ASSUMPTION").map(([k]) => k).slice(0, 5),
        requiredEvidence: ["実際の獲得単価（小規模広告テスト）"],
      };
    }
    case "PEOPLE":
      return {
        stance: "NEUTRAL",
        opinion: `主要モデル: ${d.primaryModel?.modelType ?? "未決定"}。運用・営業・パートナーの必要性を確認する。`,
        concerns: d.primaryModel?.modelType === "SERVICE" || d.primaryModel?.modelType === "MARKETPLACE_COMMISSION" ? ["運用人員・供給側パートナーの確保が必要"] : [],
        questions: ["誰がこの事業をリードし、どの専門性が不足しているか？"],
        assumptions: ["必要な人材・パートナーを確保できる"],
        requiredEvidence: ["パートナー候補へのヒアリング"],
      };
    case "SOCIAL_VALUE":
      return {
        stance: regulation && (regulation.severity === "HIGH" || regulation.severity === "CRITICAL") ? "CONCERN" : "NEUTRAL",
        opinion: regulation ? `規制面: ${regulation.answer}` : "規制・倫理面のレビューが未実施（Red Teamを推奨）。",
        concerns: ai?.epistemic === "HYPOTHESIS" ? ["AIの必要性が未検証"] : [],
        questions: ["顧客・地域・社会に負の影響はないか？", "該当する業法・個人情報保護の要件は？"],
        assumptions: ["法規制上の障害はない"],
        requiredEvidence: ["規制調査（追加調査: 規制）"],
      };
  }
}

export function runAdvisorCouncil(d: OpportunityDossier): CouncilResult {
  const perspectives: PerspectiveOpinion[] = PERSPECTIVES.map((p) => ({
    perspective: p.key,
    label: p.ja,
    lens: p.lens,
    epistemic: "INFERENCE",
    ...opinionFor(p.key, d),
  }));
  const support = perspectives.filter((p) => p.stance === "SUPPORT");
  const concern = perspectives.filter((p) => p.stance === "CONCERN");
  const consensus =
    concern.length === 0 && support.length >= 3
      ? "概ね前進に賛成。次の検証に進む価値がある。"
      : concern.length > support.length
        ? `懸念が優勢（懸念 ${concern.length} / 支持 ${support.length}）。証拠を補強してから判断すべき。`
        : `意見が分かれている（支持 ${support.length} / 懸念 ${concern.length}）。主要な前提を検証して判断する。`;
  const disagreements =
    support.length > 0 && concern.length > 0
      ? [{ topic: "前進すべきか", support: support.map((p) => p.label), concern: concern.map((p) => p.label) }]
      : [];
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  return {
    perspectives,
    consensus,
    disagreements,
    unansweredQuestions: uniq(perspectives.flatMap((p) => p.questions)),
    criticalAssumptions: uniq(perspectives.flatMap((p) => p.assumptions)).slice(0, 10),
    requiredEvidence: uniq(perspectives.flatMap((p) => p.requiredEvidence)),
  };
}
