import type { ResearchRunStatus } from "./run-state-machine";

export const RESEARCH_RUN_TYPES = [
  "PRIMARY",
  "ADDITIONAL",
  "OVERSEAS_COMPARISON",
  "COMPETITOR",
  "WILLINGNESS_TO_PAY",
  "MARKET_SIZE",
  "REGULATION",
  "PRICING",
  "DISTRIBUTION",
  "RED_TEAM",
] as const;
export type ResearchRunType = (typeof RESEARCH_RUN_TYPES)[number];

export const RUN_TYPE_LABEL_JA: Record<ResearchRunType, string> = {
  PRIMARY: "市場調査",
  ADDITIONAL: "追加調査",
  OVERSEAS_COMPARISON: "海外比較",
  COMPETITOR: "競合調査",
  WILLINGNESS_TO_PAY: "支払意思調査",
  MARKET_SIZE: "市場規模再計算",
  REGULATION: "規制調査",
  PRICING: "価格調査",
  DISTRIBUTION: "Distribution調査",
  RED_TEAM: "Red Team",
};

export type ResearchRunStats = {
  sourceItems?: number;
  duplicates?: number;
  evidence?: number;
  signals?: number;
  clusters?: number;
  opportunities?: number;
  connectorsSucceeded?: string[];
  connectorsFailed?: string[];
  connectorsSkipped?: string[];
  budgetStops?: string[];
};

export type ResearchRun = {
  id: string;
  organizationId: string;
  directiveId: string;
  parentRunId: string | null;
  opportunityId: string | null;
  runType: ResearchRunType;
  status: ResearchRunStatus;
  statusReason: string | null;
  degraded: boolean;
  stats: ResearchRunStats;
  budgetLimitUsd: number;
  costUsd: number;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
};
