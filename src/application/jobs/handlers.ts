import { z } from "zod";
import { analyzeCompetitors } from "@/application/analysis/competitors";
import { publishDailyBrief } from "@/application/executive/daily-brief";
import { checkWatchlists } from "@/application/executive/watchlist";
import { ADDITIONAL_RESEARCH_TYPES, startAdditionalResearch } from "@/application/opportunity/additional-research";
import { runRedTeam } from "@/application/opportunity/red-team";
import { reassessOpportunity } from "@/application/opportunity/reassess";
import { failResearchRun, JOB_TYPE_STAGE, runResearchStage, STAGE_JOB_TYPE, type ResearchStage } from "@/application/research/pipeline";
import { researchStageKey } from "@/application/research/dispatch";
import { JobError, type Job } from "@/domain/jobs/job";
import { RawSourceItemSchema } from "@/domain/source/source-item";
import type { JobHandler, JobHandlers } from "./worker";

/** Only COLLECTION carries user input (manual items / URLs); validated again here. */
const CollectionPayload = z.object({
  manualItems: z.array(RawSourceItemSchema).max(200).optional(),
  manualUrls: z.array(z.string().url().max(2000)).max(20).optional(),
});

function requireRun(job: Job): string {
  if (!job.researchRunId) throw new JobError(`${job.jobType} requires research_run_id`, false);
  return job.researchRunId;
}

function requireOpportunity(job: Job): string {
  if (!job.opportunityId) throw new JobError(`${job.jobType} requires opportunity_id`, false);
  return job.opportunityId;
}

const researchStage =
  (stage: ResearchStage): JobHandler =>
  async ({ job, ctx, checkpoint, enqueue }) => {
    const runId = requireRun(job);
    let payload = {};
    if (stage === "COLLECTION") {
      const parsed = CollectionPayload.safeParse(job.payload ?? {});
      if (!parsed.success) throw new JobError(`invalid ${job.jobType} payload: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`, false);
      payload = parsed.data;
    }
    const result = await runResearchStage(ctx, runId, stage, { ...payload, checkpoint });
    if (result.next) {
      // Chained stage job. Idempotent key: re-running this stage never enqueues twice.
      await enqueue({
        jobType: STAGE_JOB_TYPE[result.next],
        idempotencyKey: researchStageKey(runId, result.next),
        researchRunId: runId,
        priority: job.priority,
      });
    }
    return { runStatus: result.status, next: result.next, reason: result.reason ?? null };
  };

/** Handlers registered by every worker deployment. */
export function createJobHandlers(): JobHandlers {
  return {
    RESEARCH_COLLECTION: researchStage("COLLECTION"),
    SIGNAL_EXTRACTION: researchStage("SIGNAL_EXTRACTION"),
    CLUSTER_GENERATION: researchStage("CLUSTER_GENERATION"),
    OPPORTUNITY_GENERATION: researchStage("OPPORTUNITY_GENERATION"),

    // Additional research = a new research run chained through the same stages.
    DEEP_RESEARCH: async ({ job, ctx }) => {
      const type = z.enum(ADDITIONAL_RESEARCH_TYPES).parse(job.payload.type ?? "ADDITIONAL");
      const note = typeof job.payload.note === "string" ? job.payload.note.slice(0, 1000) : undefined;
      const r = await startAdditionalResearch(ctx, { opportunityId: requireOpportunity(job), type, note });
      return { runId: r.runId };
    },
    MARKET_SIZE_RESEARCH: async ({ job, ctx }) => {
      const r = await startAdditionalResearch(ctx, { opportunityId: requireOpportunity(job), type: "MARKET_SIZE" });
      return { runId: r.runId };
    },
    COMPETITOR_RESEARCH: async ({ job, ctx }) => {
      const rows = await analyzeCompetitors(ctx, requireOpportunity(job));
      return { competitors: rows.length };
    },
    RED_TEAM: async ({ job, ctx }) => {
      const r = await runRedTeam(ctx, requireOpportunity(job));
      return { verdict: r.verdict };
    },
    DAILY_BRIEF: async ({ ctx }) => {
      const report = await publishDailyBrief(ctx);
      return { reportId: report?.id ?? null };
    },
    WATCHLIST_REFRESH: async ({ ctx }) => checkWatchlists(ctx),
    OPPORTUNITY_REASSESSMENT: async ({ job, ctx }) => {
      const reason = typeof job.payload.reason === "string" ? job.payload.reason : "reassessment";
      const updated = await reassessOpportunity(ctx, requireOpportunity(job), reason);
      return { scoreTotal: updated.scoreTotal, confidence: updated.confidence };
    },

    // A research stage that can never succeed fails its run (never left "in progress").
    onDeadLetter: async (job, ctx, error) => {
      if (!ctx || !job.researchRunId || !JOB_TYPE_STAGE[job.jobType]) return;
      await failResearchRun(ctx, job.researchRunId, `${job.jobType}: ${error}`.slice(0, 500));
    },
    onCancelled: async (job, ctx) => {
      if (!ctx || !job.researchRunId || !JOB_TYPE_STAGE[job.jobType]) return;
      const run = await ctx.repos.research.getRun(job.researchRunId);
      if (run && !["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"].includes(run.status)) {
        await ctx.repos.research.transitionRun(run.id, "CANCELLED", { statusReason: "ユーザーがキャンセルしました" });
      }
    },
  };
}
