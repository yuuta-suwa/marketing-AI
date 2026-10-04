import { createBudgetTracker } from "@/application/budget";
import type { AppContext } from "@/application/context";
import { MARKET_DIRECTOR, parseDirective } from "@/agents/market-director";
import { authorize } from "@/domain/auth/authorization";
import { ResearchRequestSchema, type ResearchRequest } from "@/domain/research/directive";
import type { ResearchRun, ResearchRunType } from "@/domain/research/run";
import type { RawSourceItem } from "@/domain/source/source-item";

export type CreatedResearch = { run: ResearchRun; directiveId: string; parser: "rule" | "ai" };

/** Mobile input → validated ResearchDirective → QUEUED ResearchRun. */
export async function createResearch(
  ctx: AppContext,
  request: ResearchRequest,
  options: { runType?: ResearchRunType; parentRunId?: string; opportunityId?: string } = {},
): Promise<CreatedResearch> {
  authorize(ctx.actor, "research.create");
  const parsed = ResearchRequestSchema.parse(request);
  // The directive parser is optional AI work: skip the LLM if it would exceed the budget.
  let provider = ctx.ai;
  // The directive parse is the run's first LLM call: it counts toward MAX_LLM_CALLS_PER_RUN.
  if (ctx.options.limits.maxLlmCallsPerRun < 1) provider = null;
  if (provider?.isLLM) {
    const budget = await createBudgetTracker(ctx, parsed.budgetLimitUsd);
    if (!budget.check(provider.estimateCost(parsed.input.length + 1500, 800)).allowed) provider = null;
  }
  const result = await parseDirective(parsed, provider);
  if (result.fallbackReason) {
    ctx.logger.warn("directive.ai_fallback", { agent: MARKET_DIRECTOR, error: result.fallbackReason });
  }
  const directive = await ctx.repos.research.createDirective({
    directive: result.directive,
    parser: result.parser,
    parseMetadata: result.fallbackReason ? { fallbackReason: result.fallbackReason } : {},
  });
  const run = await ctx.repos.research.createRun({
    directiveId: directive.id,
    runType: options.runType ?? "PRIMARY",
    budgetLimitUsd: directive.budgetLimitUsd,
    parentRunId: options.parentRunId,
    opportunityId: options.opportunityId,
  });
  const queued = await ctx.repos.research.transitionRun(run.id, "QUEUED");
  if (result.costUsd > 0) {
    await ctx.repos.ops.recordCost({
      category: "AI",
      provider: ctx.ai?.id ?? "unknown",
      model: ctx.ai?.model,
      agentName: MARKET_DIRECTOR,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      amountUsd: result.costUsd,
      researchRunId: run.id,
    });
  }
  await ctx.repos.ops.audit("research.created", "research_run", run.id, { runType: queued.runType });
  return { run: queued, directiveId: directive.id, parser: result.parser };
}

/** Manual import payload from the mobile form. */
export function toManualItems(items: ResearchRequest["manualItems"]): RawSourceItem[] {
  return (items ?? []).map((m) => ({
    sourceType: "MANUAL",
    sourceName: m.sourceName?.trim() || "Manual Import",
    sourceUrl: m.url,
    title: m.title,
    body: m.body,
    language: m.language,
    country: m.country,
    publishedAt: m.publishedAt,
  }));
}
