import type { AgentRunner } from "@/application/agent-runner";
import type { AppContext } from "@/application/context";
import { PAIN_MINER, estimateExtractionCost, heuristicExtraction, llmExtraction, type ExtractionResult } from "@/agents/pain-miner";
import type { Evidence } from "@/domain/evidence/evidence";
import type { ResearchDirective } from "@/domain/research/directive";
import type { StoredSignal } from "@/domain/signal/signal";

/**
 * Signals via PainMinerAgent. LLM extraction runs in bounded batches when a
 * provider is configured and budget allows; otherwise (or on failure) the
 * deterministic extractor is used for that batch. Every signal cites only
 * evidence ids that exist.
 */
export async function extractSignals(
  ctx: AppContext,
  runner: AgentRunner,
  input: { runId: string; directive: ResearchDirective; evidence: Evidence[] },
): Promise<{ signals: StoredSignal[]; rejected: number; budgetStops: string[] }> {
  const batches: Evidence[][] = [];
  for (let i = 0; i < input.evidence.length; i += ctx.options.llmEvidenceBatchSize) {
    batches.push(input.evidence.slice(i, i + ctx.options.llmEvidenceBatchSize));
  }
  const evidenceById = new Map(input.evidence.map((e) => [e.id, e]));
  const budgetStops: string[] = [];
  let rejected = 0;
  const stored: StoredSignal[] = [];

  for (const batch of batches) {
    let result: ExtractionResult | null = null;
    if (ctx.ai?.isLLM) {
      const ai = ctx.ai;
      const outcome = await runner.run({
        agentName: PAIN_MINER,
        provider: ai.id,
        model: ai.model,
        input: { evidenceIds: batch.map((e) => e.id) },
        estimateUsd: estimateExtractionCost(ai, batch),
        researchRunId: input.runId,
        execute: async () => {
          const r = await llmExtraction(ai, batch, input.directive);
          return { output: r, usage: r.llm!.usage, costUsd: r.llm!.costUsd, provider: r.llm!.provider, model: r.llm!.model };
        },
      });
      if (outcome.status === "SUCCEEDED") result = outcome.output;
      if (outcome.status === "SKIPPED_BUDGET") budgetStops.push(`${PAIN_MINER}: ${outcome.reason}`);
    }
    if (!result) {
      const outcome = await runner.run({
        agentName: `${PAIN_MINER}:heuristic`,
        provider: "heuristic",
        model: "signal-v1",
        input: { evidenceIds: batch.map((e) => e.id) },
        estimateUsd: 0,
        researchRunId: input.runId,
        execute: async () => {
          const r = heuristicExtraction(batch, input.directive);
          return { output: r, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, provider: "heuristic", model: "signal-v1" };
        },
      });
      if (outcome.status !== "SUCCEEDED") continue;
      result = outcome.output;
    }
    rejected += result.rejected;
    if (result.signals.length === 0) continue;
    const inserted = await ctx.repos.signals.insertSignals(
      result.signals.map((s) => {
        const first = evidenceById.get(s.evidenceIds[0]);
        return {
          ...s,
          researchRunId: input.runId,
          language: first?.language,
          country: first?.country,
          extractedBy: result!.extractedBy,
        };
      }),
    );
    stored.push(...inserted);
  }
  return { signals: stored, rejected, budgetStops };
}
