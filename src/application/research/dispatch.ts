import type { AppContext } from "@/application/context";
import { authorize } from "@/domain/auth/authorization";
import type { Job } from "@/domain/jobs/job";
import type { RawSourceItem } from "@/domain/source/source-item";
import type { ResearchStage } from "./pipeline";

/** Result of starting research: the run exists, the work is queued. */
export type ResearchDispatch = { runId: string; jobId: string; jobStatus: Job["status"] };

export function researchStageKey(runId: string, stage: ResearchStage): string {
  return `research:${runId}:${stage}`;
}

/**
 * Enqueues the first stage of a research run and returns immediately.
 * The HTTP request never waits for collection or analysis: a background
 * worker picks the job up (see application/jobs/worker.ts). Idempotent —
 * dispatching the same run twice returns the existing job.
 */
export async function dispatchResearch(
  ctx: AppContext,
  runId: string,
  input: { manualItems?: RawSourceItem[]; manualUrls?: string[]; priority?: number } = {},
): Promise<ResearchDispatch> {
  authorize(ctx.actor, "research.create");
  const payload: Record<string, unknown> = {};
  if (input.manualItems?.length) payload.manualItems = input.manualItems;
  if (input.manualUrls?.length) payload.manualUrls = input.manualUrls;
  const { job, created } = await ctx.repos.jobs.enqueue({
    jobType: "RESEARCH_COLLECTION",
    idempotencyKey: researchStageKey(runId, "COLLECTION"),
    researchRunId: runId,
    payload,
    priority: input.priority ?? 100,
  });
  if (created) await ctx.repos.ops.audit("job.enqueued", "research_run", runId, { jobId: job.id, jobType: job.jobType });
  return { runId, jobId: job.id, jobStatus: job.status };
}
