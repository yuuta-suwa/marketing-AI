export const COST_CATEGORIES = ["AI", "EMBEDDING", "SEARCH_API", "EXTERNAL_API", "CONNECTOR"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export type CostEntry = {
  category: CostCategory;
  provider: string;
  model?: string;
  connectorKey?: string;
  agentName?: string;
  inputTokens?: number;
  outputTokens?: number;
  units?: number;
  amountUsd: number;
  researchRunId?: string;
  agentRunId?: string;
  metadata?: Record<string, unknown>;
};

export type CostEstimate = {
  amountUsd: number;
  basis: string;
};
