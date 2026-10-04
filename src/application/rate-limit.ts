import type { AppContext } from "@/application/context";
import { DomainError } from "@/domain/shared/errors";

/** Per-user limits for actions that spend money or heavy compute. */
export const RATE_LIMITS = {
  "research.start": { max: 20, windowSeconds: 3600 },
  "research.additional": { max: 30, windowSeconds: 3600 },
  "friday.command": { max: 60, windowSeconds: 600 },
  "analysis.run": { max: 120, windowSeconds: 3600 },
  "report.generate": { max: 30, windowSeconds: 3600 },
  "url.import": { max: 40, windowSeconds: 3600 },
} as const;
export type RateLimitBucket = keyof typeof RATE_LIMITS;

export async function enforceRateLimit(ctx: AppContext, bucket: RateLimitBucket): Promise<void> {
  const { max, windowSeconds } = RATE_LIMITS[bucket];
  if (!(await ctx.repos.ops.consumeRateLimit(bucket, max, windowSeconds))) {
    ctx.logger.warn("rate_limited", { bucket, status: "RATE_LIMITED" });
    throw new DomainError("RATE_LIMITED", `操作の上限に達しました（${Math.round(windowSeconds / 60)}分あたり${max}回）。しばらくしてから再試行してください。`);
  }
}
