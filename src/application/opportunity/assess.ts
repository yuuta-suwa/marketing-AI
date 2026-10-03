import type { Evidence } from "@/domain/evidence/evidence";
import { computeConfidence, type ConfidenceBreakdown } from "@/domain/scoring/confidence";
import type { ScoreCriterion } from "@/domain/scoring/criteria";
import type { CriterionInput } from "@/domain/scoring/score";
import { clamp01, mean } from "@/domain/shared/math";
import type { StoredSignal } from "@/domain/signal/signal";
import type { SourceItem } from "@/domain/source/source-item";

export type ClusterStats = {
  signalCount: number;
  painScore: number;
  paySignalScore: number;
  momentum: number;
  datedObservations: number;
};

/**
 * Score inputs derived ONLY from observed signals. Criteria that need
 * analyses not yet performed (market size, competition, CFO…) stay null and
 * are reported as unassessed rather than guessed.
 */
export function deriveScoreInputs(
  cluster: ClusterStats,
  signals: readonly StoredSignal[],
): Partial<Record<ScoreCriterion, CriterionInput>> {
  const share = (pred: (s: StoredSignal) => boolean) =>
    signals.length === 0 ? 0 : signals.filter(pred).length / signals.length;
  const payEvidence = signals.some((s) => s.signalType === "PAY_SIGNAL" || s.willingnessToPayScore >= 50);
  const gapShare = share((s) => ["WORKAROUND", "SWITCHING", "REQUEST"].includes(s.signalType));

  const inputs: Partial<Record<ScoreCriterion, CriterionInput>> = {
    painSeverity: {
      value: cluster.painScore / 100,
      rationale: `シグナルの緊急度平均 ${cluster.painScore}/100`,
      epistemic: "INFERENCE",
    },
    frequency: {
      value: clamp01(0.6 * Math.min(1, cluster.signalCount / 10) + 0.4 * (mean(signals.map((s) => s.frequencySignal)) / 100)),
      rationale: `${cluster.signalCount}件のシグナル、頻度表現の平均 ${Math.round(mean(signals.map((s) => s.frequencySignal)))}/100`,
      epistemic: "INFERENCE",
    },
    willingnessToPay: payEvidence
      ? { value: cluster.paySignalScore / 100, rationale: `支払意思スコア平均 ${cluster.paySignalScore}/100`, epistemic: "INFERENCE" }
      : { value: 0.2, rationale: "支払意思を示す証拠は未検出", epistemic: "INFERENCE" },
    existingSolutionGap: {
      value: clamp01(0.3 + 0.7 * gapShare),
      rationale: `代替行動・乗換・要望シグナルの比率 ${Math.round(gapShare * 100)}%`,
      epistemic: "INFERENCE",
    },
  };
  if (cluster.datedObservations >= 3) {
    inputs.trendMomentum = {
      value: clamp01((cluster.momentum + 100) / 200),
      rationale: `直近30日 vs 前30日のモメンタム ${cluster.momentum}`,
      epistemic: "CALCULATION",
    };
  }
  return inputs;
}

/** Channel = connector, except manual uploads where the declared source name counts. */
export function channelOf(item: Pick<SourceItem, "connectorId" | "sourceName">): string {
  return item.connectorId === "manual_import" ? `manual:${item.sourceName}` : item.connectorId;
}

export function assessConfidence(
  evidence: readonly Evidence[],
  sourceItems: ReadonlyMap<string, SourceItem>,
  qualityOf: (connectorId: string) => number,
  now: string,
): ConfidenceBreakdown {
  const items = evidence.map((e) => sourceItems.get(e.sourceItemId)).filter((s): s is SourceItem => Boolean(s));
  return computeConfidence({
    sourceQualities: items.map((s) => qualityOf(s.connectorId)),
    distinctSources: new Set(items.map((s) => `${s.connectorId}:${s.sourceName}:${s.canonicalUrl ?? s.id}`)).size,
    distinctChannels: new Set(items.map(channelOf)).size,
    observedAt: items.map((s) => s.publishedAt ?? s.retrievedAt),
    evidenceCount: evidence.length,
    contradictions: 0,
    now,
  });
}
