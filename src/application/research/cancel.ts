import type { AppContext } from "@/application/context";
import { authorize } from "@/domain/auth/authorization";

/**
 * The approved way for a member to stop a research run. Members cannot
 * update run status directly (worker-controlled); the request cancels queued
 * jobs and asks a running worker to stop at its next checkpoint.
 */
export async function requestResearchCancellation(ctx: AppContext, runId: string) {
  authorize(ctx.actor, "research.create");
  return ctx.repos.research.requestCancellation(runId);
}
