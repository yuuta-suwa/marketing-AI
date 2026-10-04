import { round } from "../shared/math";

export type BudgetScope = "run" | "daily" | "monthly";

export type BudgetLimits = {
  perRunUsd: number;
  dailyUsd: number;
  monthlyUsd: number;
};

export type SpendSnapshot = {
  runUsd: number;
  dailyUsd: number;
  monthlyUsd: number;
};

export type BudgetDecision =
  | { allowed: true; remainingUsd: number }
  | { allowed: false; scope: BudgetScope; reason: string; limitUsd: number; projectedUsd: number };

/**
 * Pure budget check: would spending `estimateUsd` more exceed any limit?
 * Optional work (deep research, extra agents) must stop on a negative answer;
 * already-collected data is kept and the reason is shown to the user.
 */
export function checkBudget(limits: BudgetLimits, spent: SpendSnapshot, estimateUsd: number): BudgetDecision {
  const est = Math.max(0, estimateUsd);
  const checks: Array<[BudgetScope, number, number, string]> = [
    ["run", spent.runUsd + est, limits.perRunUsd, "この調査の予算上限"],
    ["daily", spent.dailyUsd + est, limits.dailyUsd, "本日の予算上限"],
    ["monthly", spent.monthlyUsd + est, limits.monthlyUsd, "今月の予算上限"],
  ];
  for (const [scope, projected, limit, label] of checks) {
    if (projected > limit + 1e-9) {
      return {
        allowed: false,
        scope,
        limitUsd: limit,
        projectedUsd: round(projected, 6),
        reason: `${label}（$${limit.toFixed(2)}）を超えるため停止しました（見込み $${projected.toFixed(4)}）`,
      };
    }
  }
  const remaining = Math.min(
    limits.perRunUsd - spent.runUsd,
    limits.dailyUsd - spent.dailyUsd,
    limits.monthlyUsd - spent.monthlyUsd,
  );
  return { allowed: true, remainingUsd: round(remaining - est, 6) };
}

/** Mutable tracker used inside one pipeline execution. */
export class BudgetTracker {
  private runSpent: number;

  /**
   * @param alreadySpentThisRun spend of earlier stages of the same run (already
   *   included in the daily/monthly baseline, so it only counts toward the run limit).
   */
  constructor(
    private readonly limits: BudgetLimits,
    private readonly baseline: { dailyUsd: number; monthlyUsd: number },
    private readonly alreadySpentThisRun = 0,
  ) {
    this.runSpent = Math.max(0, alreadySpentThisRun);
  }

  get spentThisRun(): number {
    return this.runSpent;
  }

  check(estimateUsd: number): BudgetDecision {
    return checkBudget(
      this.limits,
      {
        runUsd: this.runSpent,
        dailyUsd: this.baseline.dailyUsd + this.runSpent - this.alreadySpentThisRun,
        monthlyUsd: this.baseline.monthlyUsd + this.runSpent - this.alreadySpentThisRun,
      },
      estimateUsd,
    );
  }

  record(amountUsd: number): void {
    this.runSpent += Math.max(0, amountUsd);
  }
}
