import { describe, expect, it } from "vitest";
import { enforceRateLimit, RATE_LIMITS } from "@/application/rate-limit";
import { testContext } from "../helpers/context";

describe("rate limiting", () => {
  it("blocks a user after the bucket limit within the window, per user", async () => {
    const ctx = testContext();
    const { max } = RATE_LIMITS["research.start"];
    for (let i = 0; i < max; i++) await enforceRateLimit(ctx, "research.start");
    await expect(enforceRateLimit(ctx, "research.start")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // other buckets and other users are unaffected
    await enforceRateLimit(ctx, "analysis.run");
    const other = testContext({ db: ctx.db, actor: { ...ctx.actor, userId: "someone-else" } });
    await enforceRateLimit(other, "research.start");
  });
});
