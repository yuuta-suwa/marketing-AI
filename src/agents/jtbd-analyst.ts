import { z } from "zod";
import type { AIProvider, GenerateResult } from "@/domain/agent/ai-provider";
import { validateEvidenceRefs, type Evidence } from "@/domain/evidence/evidence";
import { OpportunityDraftSchema, type OpportunityDraft } from "@/domain/opportunity/opportunity";
import type { ResearchDirective } from "@/domain/research/directive";
import type { EpistemicStatus } from "@/domain/shared/epistemic";
import { SIGNAL_TYPE_LABEL_JA, type SignalType, type StoredSignal } from "@/domain/signal/signal";
import { buildAgentPrompt, composeSystem } from "@/domain/agent/prompt-boundary";

export const JTBD_ANALYST = "JTBDAnalystAgent";

export type ClusterContext = {
  id: string;
  name: string;
  dominantType: SignalType;
  signalCount: number;
  sourceCount: number;
  paySignalScore: number;
};

/** How the title frames each dominant signal type (labels, not claims). */
const TITLE_FRAME: Partial<Record<SignalType, string>> = {
  PAY_SIGNAL: "支払意思のある需要",
  REQUEST: "未対応の要望",
  SWITCHING: "乗換需要の受け皿",
  WORKAROUND: "代替行動の置き換え",
  SHORTAGE: "不足の解消",
  CAPACITY_GAP: "待ち・満席の解消",
};

const REVENUE_HYPOTHESIS: Partial<Record<SignalType, string>> = {
  PAY_SIGNAL: "有料プラン / 従量課金（支払意思の表明あり — 価格受容性は未検証）",
  PRICE_GAP: "価格比較・代替調達による手数料モデル（仮説）",
  CAPACITY_GAP: "予約・空き枠マッチングの取引手数料モデル（仮説）",
  SHORTAGE: "在庫・供給マッチングのマーケットプレイス手数料（仮説）",
  DISTRIBUTION_GAP: "流通代行・リード獲得型の手数料モデル（仮説）",
  INFORMATION_GAP: "情報提供サービス（広告 / 送客手数料 / 事業者向けSaaS）の比較検証が必要（仮説）",
  TRUST_GAP: "検証・認証サービスの事業者課金（仮説）",
  REGULATION_GAP: "手続き代行サービス / 専門家マッチング（仮説）",
  WORKAROUND: "代替行動を置き換えるツールのサブスクリプション（仮説）",
  SWITCHING: "乗換先としての代替サービス（既存サービスの不満点を解消）（仮説）",
};

/**
 * Deterministic opportunity framing. Every field is labelled with its
 * epistemic status. Market size is NEVER estimated here — it requires
 * the QuantAnalyst with cited inputs.
 */
export function draftOpportunityHeuristically(
  cluster: ClusterContext,
  signals: readonly StoredSignal[],
  directive: Pick<ResearchDirective, "personas" | "categories" | "countries">,
): OpportunityDraft {
  const byType = (t: SignalType) => signals.filter((s) => s.signalType === t);
  const representative = [...signals].sort((a, b) => b.urgencyScore - a.urgencyScore)[0];
  const requests = byType("REQUEST");
  const workarounds = byType("WORKAROUND");
  const pays = byType("PAY_SIGNAL");
  const evidenceIds = [...new Set(signals.flatMap((s) => s.evidenceIds))];
  const label = SIGNAL_TYPE_LABEL_JA[cluster.dominantType];
  const customer = directive.personas[0] ?? representative.persona;
  const region = directive.countries.filter((c) => c !== "GLOBAL").join("/") || "対象地域";

  const provenance: Record<string, EpistemicStatus> = {
    title: "HYPOTHESIS",
    pain: "FACT",
    customer: customer ? "INFERENCE" : "ASSUMPTION",
    paySignal: "FACT",
    marketGap: "INFERENCE",
    revenueModel: "HYPOTHESIS",
    marketSizeSummary: "ASSUMPTION",
    mainRisk: "INFERENCE",
    nextExperiment: "HYPOTHESIS",
    killCriteria: "HYPOTHESIS",
    aiNecessity: "HYPOTHESIS",
  };
  if (requests.length) provenance.desiredOutcome = "FACT";
  if (workarounds.length) provenance.currentAlternatives = "FACT";

  const draft: OpportunityDraft = {
    title: `${cluster.name.split(": ")[1] ?? label} — ${TITLE_FRAME[cluster.dominantType] ?? `${label}の解消`}`.slice(0, 300),
    customer: customer ?? "未特定（顧客セグメントの調査が必要）",
    situation: representative.situation,
    pain: representative.problem,
    desiredOutcome: requests[0]?.problem,
    currentAlternatives: workarounds[0]?.problem,
    marketGap: `${region}で${cluster.signalCount}件の${label}シグナルを${cluster.sourceCount}ソースから検出。既存手段で解消されていない可能性がある（競合調査で要確認）。`,
    paySignal:
      pays.length > 0
        ? `支払意思を示す記述 ${pays.length}件（例:「${pays[0].problem.slice(0, 60)}」）`
        : "支払意思の直接的な証拠は未検出",
    marketSizeSummary: "未推定 — 根拠データ（統計・取引量）取得後にQuantAnalystが算出",
    revenueModel: REVENUE_HYPOTHESIS[cluster.dominantType] ?? "収益モデルは未検証（BusinessModelAgentで比較）",
    aiNecessity: "未評価 — AIでなくても解決できるかをRed Teamで検証",
    mainRisk:
      cluster.sourceCount <= 1
        ? "単一ソース由来のため市場全体の傾向とは断定できない"
        : pays.length === 0
          ? "支払意思が未確認"
          : "既存競合による模倣・代替",
    nextExperiment: `対象顧客5〜10名へのインタビューで「${label}」の頻度・深刻度・現在の代替手段と支払意思を確認する`,
    killCriteria: "インタビュー対象の過半数が課題を『月1回未満』または『対価を払うほどではない』と回答した場合は撤退",
    fieldProvenance: provenance,
    evidenceIds,
  };
  return OpportunityDraftSchema.parse(draft);
}

const SYSTEM = `You are JTBDAnalystAgent of MARKET RADAR OS.
Turn one evidence-backed signal cluster into a business opportunity hypothesis.
Hard rules:
- Cite evidence ids ONLY from the list given in "evidenceIds". Never invent ids.
- Do not state market sizes, prices, competitor names or statistics unless they appear verbatim in the evidence. Otherwise write that it is unverified.
- fieldProvenance must label every field you fill as FACT (directly stated in evidence), INFERENCE, HYPOTHESIS or ASSUMPTION.
- Write in Japanese. Respond with JSON only.`;

export async function draftOpportunityWithLLM(
  provider: AIProvider,
  cluster: ClusterContext,
  signals: readonly StoredSignal[],
  evidence: readonly Evidence[],
  directive: ResearchDirective,
): Promise<{ draft: OpportunityDraft; llm: Omit<GenerateResult<unknown>, "output"> }> {
  const known = new Set(evidence.map((e) => e.id));
  const res = await provider.generate({
    agent: JTBD_ANALYST,
    system: composeSystem(SYSTEM),
    prompt: buildAgentPrompt({
      task: "Draft one business opportunity hypothesis for this cluster.",
      directive: { objective: directive.objective },
      externalData: {
        cluster: { name: cluster.name, signalCount: cluster.signalCount, sourceCount: cluster.sourceCount },
        signals: signals.map((s) => ({ type: s.signalType, problem: s.problem, evidenceIds: s.evidenceIds })),
        evidence: evidence.map((e) => ({ id: e.id, text: e.evidenceText })),
      },
    }),
    schema: OpportunityDraftSchema.extend({ evidenceIds: z.array(z.string()).min(1) }),
    maxOutputTokens: 2500,
  });
  const { valid, invalid } = validateEvidenceRefs(res.output.evidenceIds, known);
  if (invalid.length > 0 || valid.length === 0) {
    throw new Error(`JTBDAnalystAgent cited unknown evidence ids: ${invalid.join(", ") || "(none cited)"}`);
  }
  return {
    draft: { ...res.output, evidenceIds: valid },
    llm: { usage: res.usage, costUsd: res.costUsd, provider: res.provider, model: res.model },
  };
}
