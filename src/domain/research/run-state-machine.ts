import { DomainError } from "../shared/errors";

export const RESEARCH_RUN_STATUSES = [
  "DRAFT",
  "QUEUED",
  "COLLECTING",
  "NORMALIZING",
  "EXTRACTING",
  "CLUSTERING",
  "ANALYZING",
  "VALIDATING",
  "COMPLETED",
  "PARTIAL_SUCCESS",
  "FAILED",
  "CANCELLED",
] as const;
export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: ReadonlySet<ResearchRunStatus> = new Set([
  "COMPLETED",
  "PARTIAL_SUCCESS",
  "FAILED",
  "CANCELLED",
]);

/**
 * Forward-only pipeline. Any active state may fail or be cancelled; a pipeline
 * stage may end early as PARTIAL_SUCCESS when downstream stages have nothing
 * to do but useful data was already persisted.
 * MUST stay identical to private.research_run_transition_allowed() in SQL.
 */
const FORWARD: Record<ResearchRunStatus, readonly ResearchRunStatus[]> = {
  DRAFT: ["QUEUED"],
  QUEUED: ["COLLECTING"],
  COLLECTING: ["NORMALIZING", "PARTIAL_SUCCESS"],
  NORMALIZING: ["EXTRACTING", "PARTIAL_SUCCESS"],
  EXTRACTING: ["CLUSTERING", "PARTIAL_SUCCESS"],
  CLUSTERING: ["ANALYZING", "PARTIAL_SUCCESS"],
  ANALYZING: ["VALIDATING", "COMPLETED", "PARTIAL_SUCCESS"],
  VALIDATING: ["COMPLETED", "PARTIAL_SUCCESS"],
  COMPLETED: [],
  PARTIAL_SUCCESS: [],
  FAILED: [],
  CANCELLED: [],
};

export function isTerminalRunStatus(status: ResearchRunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function canTransitionRun(from: ResearchRunStatus, to: ResearchRunStatus): boolean {
  if (from === to) return true;
  if (isTerminalRunStatus(from)) return false;
  if (to === "FAILED" || to === "CANCELLED") return true;
  return FORWARD[from].includes(to);
}

export function assertRunTransition(from: ResearchRunStatus, to: ResearchRunStatus): void {
  if (!canTransitionRun(from, to)) {
    throw new DomainError("ILLEGAL_TRANSITION", `Illegal research run transition ${from} -> ${to}`, {
      from,
      to,
    });
  }
}

export const RUN_STATUS_LABEL_JA: Record<ResearchRunStatus, string> = {
  DRAFT: "下書き",
  QUEUED: "待機中",
  COLLECTING: "収集中",
  NORMALIZING: "正規化中",
  EXTRACTING: "シグナル抽出中",
  CLUSTERING: "クラスタリング中",
  ANALYZING: "機会分析中",
  VALIDATING: "検証中",
  COMPLETED: "完了",
  PARTIAL_SUCCESS: "一部成功",
  FAILED: "失敗",
  CANCELLED: "キャンセル",
};
