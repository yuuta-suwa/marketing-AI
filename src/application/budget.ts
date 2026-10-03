import type { AppContext } from "@/application/context";
import { BudgetTracker } from "@/domain/cost/budget";

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/**
 * Budget tracker for one unit of work, seeded with the organization's
 * limits and today's / this month's recorded spend (cost_ledger).
 */
export async function createBudgetTracker(ctx: AppContext, runLimitUsd?: number): Promise<BudgetTracker> {
  const limits = await ctx.repos.ops.getBudget();
  const now = ctx.clock.now();
  const [dailyUsd, monthlyUsd] = await Promise.all([
    ctx.repos.ops.spendSince(startOfUtcDay(now)),
    ctx.repos.ops.spendSince(startOfUtcMonth(now)),
  ]);
  return new BudgetTracker(
    { ...limits, perRunUsd: runLimitUsd === undefined ? limits.perRunUsd : Math.min(limits.perRunUsd, runLimitUsd) },
    { dailyUsd, monthlyUsd },
  );
}
