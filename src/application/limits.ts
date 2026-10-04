import { z } from "zod";

/**
 * Operator-level hard limits (environment). They cap — never raise — the
 * per-organization budgets stored in the database. When a limit is reached
 * the pipeline keeps everything already persisted, skips the optional work,
 * finishes as PARTIAL_SUCCESS and records what was skipped (stats.limitStops).
 */
export type HardLimits = {
  maxCostPerResearchRunUsd: number;
  maxDailyAiCostUsd: number;
  maxMonthlyAiCostUsd: number;
  maxSearchRequestsPerRun: number;
  maxSourceItemsPerRun: number;
  maxLlmCallsPerRun: number;
};

export const DEFAULT_HARD_LIMITS: HardLimits = {
  maxCostPerResearchRunUsd: 1,
  maxDailyAiCostUsd: 10,
  maxMonthlyAiCostUsd: 100,
  maxSearchRequestsPerRun: 10,
  maxSourceItemsPerRun: 200,
  maxLlmCallsPerRun: 40,
};

export const HARD_LIMIT_ENV: Record<keyof HardLimits, string> = {
  maxCostPerResearchRunUsd: "MAX_COST_PER_RESEARCH_RUN",
  maxDailyAiCostUsd: "MAX_DAILY_AI_COST",
  maxMonthlyAiCostUsd: "MAX_MONTHLY_AI_COST",
  maxSearchRequestsPerRun: "MAX_SEARCH_REQUESTS_PER_RUN",
  maxSourceItemsPerRun: "MAX_SOURCE_ITEMS_PER_RUN",
  maxLlmCallsPerRun: "MAX_LLM_CALLS_PER_RUN",
};

const money = z.coerce.number().finite().min(0).max(10_000);
const count = z.coerce.number().int().min(0).max(100_000);
const SCHEMA: Record<keyof HardLimits, z.ZodType<number>> = {
  maxCostPerResearchRunUsd: money,
  maxDailyAiCostUsd: money,
  maxMonthlyAiCostUsd: money,
  maxSearchRequestsPerRun: count,
  maxSourceItemsPerRun: count,
  maxLlmCallsPerRun: count,
};

/**
 * Reads the limits. An invalid value is a configuration error (thrown), not
 * something to silently replace with a default.
 */
export function hardLimitsFromEnv(env: (name: string) => string | undefined = (n) => process.env[n]): HardLimits {
  const out = { ...DEFAULT_HARD_LIMITS };
  for (const key of Object.keys(HARD_LIMIT_ENV) as Array<keyof HardLimits>) {
    const raw = env(HARD_LIMIT_ENV[key]);
    if (raw === undefined || raw.trim() === "") continue;
    const parsed = SCHEMA[key].safeParse(raw);
    if (!parsed.success) throw new Error(`Invalid ${HARD_LIMIT_ENV[key]}=${JSON.stringify(raw)}: expected a non-negative number`);
    out[key] = parsed.data;
  }
  return out;
}

/** Shared counter for one run (search requests, LLM calls) across parallel work. */
export class RunCounter {
  constructor(
    readonly label: string,
    readonly limit: number,
    private used = 0,
  ) {}

  get count(): number {
    return this.used;
  }

  /** Reserves one unit; false when the limit is reached. */
  tryTake(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  get stopReason(): string {
    return `${this.label}の上限（${this.limit}回）に達したため、以降の処理を省略しました`;
  }
}
