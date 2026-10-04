import type { ResearchRunStatus } from "./run-state-machine";

/**
 * Progress shown to the user. Percent is tied to the persisted status, so it
 * only moves when the worker has actually finished the preceding stage.
 */
export const RUN_PROGRESS: Record<ResearchRunStatus, number> = {
  DRAFT: 0,
  QUEUED: 5,
  COLLECTING: 20,
  NORMALIZING: 30,
  EXTRACTING: 50,
  CLUSTERING: 65,
  ANALYZING: 80,
  VALIDATING: 90,
  COMPLETED: 100,
  PARTIAL_SUCCESS: 100,
  FAILED: 100,
  CANCELLED: 100,
};

export const RUN_ACTION_JA: Record<ResearchRunStatus, string> = {
  DRAFT: "調査指示を作成中",
  QUEUED: "ワーカーの割り当てを待っています",
  COLLECTING: "Webから市場情報を収集中",
  NORMALIZING: "収集データを整理・重複除去中",
  EXTRACTING: "Evidenceを分析中",
  CLUSTERING: "類似する課題を整理中",
  ANALYZING: "事業機会を評価中",
  VALIDATING: "根拠のつながりを検証中",
  COMPLETED: "調査が完了しました",
  PARTIAL_SUCCESS: "一部の処理を省略して完了しました",
  FAILED: "調査に失敗しました",
  CANCELLED: "調査はキャンセルされました",
};

/** Percent for a status, optionally advanced within the stage (0..1). */
export function progressFor(status: ResearchRunStatus, withinStage = 0): number {
  const order: ResearchRunStatus[] = ["QUEUED", "COLLECTING", "NORMALIZING", "EXTRACTING", "CLUSTERING", "ANALYZING", "VALIDATING", "COMPLETED"];
  const base = RUN_PROGRESS[status];
  const i = order.indexOf(status);
  if (i < 0 || i === order.length - 1) return base;
  const next = RUN_PROGRESS[order[i + 1]];
  const f = Math.min(1, Math.max(0, withinStage));
  return Math.min(next - 1, Math.round(base + (next - base) * f));
}

/** Ordinal for forward-only comparisons ("has the run reached stage X?"). */
const STAGE_ORDER: Record<ResearchRunStatus, number> = {
  DRAFT: 0,
  QUEUED: 1,
  COLLECTING: 2,
  NORMALIZING: 3,
  EXTRACTING: 4,
  CLUSTERING: 5,
  ANALYZING: 6,
  VALIDATING: 7,
  COMPLETED: 8,
  PARTIAL_SUCCESS: 8,
  FAILED: 8,
  CANCELLED: 8,
};

export function stageReached(current: ResearchRunStatus, target: ResearchRunStatus): boolean {
  return STAGE_ORDER[current] >= STAGE_ORDER[target];
}
