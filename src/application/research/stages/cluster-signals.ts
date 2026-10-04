import type { AppContext } from "@/application/context";
import type { NewCluster, StoredCluster } from "@/application/ports/repositories";
import type { AgentRunner } from "@/application/agent-runner";
import type { BudgetTracker } from "@/domain/cost/budget";
import { clusterSignals, type ClusterableSignal } from "@/domain/cluster/cluster";
import type { Evidence } from "@/domain/evidence/evidence";
import { SIGNAL_TYPE_LABEL_JA, type StoredSignal } from "@/domain/signal/signal";
import type { SourceItem } from "@/domain/source/source-item";
import { CLUSTER_NAMER, nameClusterHeuristically, nameClusterWithLLM } from "@/agents/cluster-namer";
import { assessConfidence } from "@/application/opportunity/assess";

/** Semantic representation of a signal used for embeddings. */
export function signalText(s: Pick<StoredSignal, "problem" | "situation" | "desiredOutcome"> & Partial<Pick<StoredSignal, "signalType" | "persona" | "currentAlternative">>): string {
  return [
    s.signalType ? `[${SIGNAL_TYPE_LABEL_JA[s.signalType]}]` : null,
    s.persona ? `persona: ${s.persona}` : null,
    s.situation ? `situation: ${s.situation}` : null,
    s.problem,
    s.desiredOutcome ? `wants: ${s.desiredOutcome}` : null,
    s.currentAlternative ? `alternative: ${s.currentAlternative}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Embeds signals (paid provider within budget, else local) and stores vectors. */
export async function embedSignals(
  ctx: AppContext,
  input: { runId: string; signals: StoredSignal[]; budget: BudgetTracker },
): Promise<{ vectors: Map<string, number[]>; model: string; budgetStop?: string }> {
  const texts = input.signals.map(signalText);
  let provider = ctx.embeddings;
  let budgetStop: string | undefined;
  if (provider.id !== ctx.fallbackEmbeddings.id) {
    const estimate = texts.reduce((n, t) => n + t.length, 0) / 1_000_000 * 0.02 * 2;
    const decision = input.budget.check(estimate);
    if (!decision.allowed) {
      budgetStop = `Embedding: ${decision.reason}`;
      provider = ctx.fallbackEmbeddings;
    }
  }
  let result;
  try {
    result = await provider.embed(texts);
  } catch (e) {
    ctx.logger.warn("embedding.fallback", { research_run_id: input.runId, error: (e as Error).message });
    provider = ctx.fallbackEmbeddings;
    result = await provider.embed(texts);
  }
  if (result.costUsd > 0) {
    input.budget.record(result.costUsd);
    await ctx.repos.ops.recordCost({
      category: "EMBEDDING",
      provider: provider.id,
      model: provider.model,
      inputTokens: result.usage.inputTokens,
      amountUsd: result.costUsd,
      researchRunId: input.runId,
    });
  }
  const vectors = new Map(input.signals.map((s, i) => [s.id, result.vectors[i]]));
  await ctx.repos.signals.setEmbeddings(
    input.signals.map((s, i) => ({ id: s.id, embedding: result.vectors[i], model: `${provider.id}:${provider.model}` })),
  );
  return { vectors, model: `${provider.id}:${provider.model}`, budgetStop };
}

export async function buildClusters(
  ctx: AppContext,
  input: {
    runId: string;
    signals: StoredSignal[];
    vectors: Map<string, number[]>;
    evidence: Map<string, Evidence>;
    sourceItems: Map<string, SourceItem>;
    qualityOf: (connectorId: string) => number;
    runner?: AgentRunner;
  },
): Promise<StoredCluster[]> {
  const sourceOf = (evidenceId: string) => {
    const e = input.evidence.get(evidenceId);
    return e ? input.sourceItems.get(e.sourceItemId) : undefined;
  };
  const clusterable: ClusterableSignal[] = input.signals.map((s) => {
    const sources = s.evidenceIds.map(sourceOf).filter((x): x is SourceItem => Boolean(x));
    return {
      id: s.id,
      orderKey: signalText(s),
      signalType: s.signalType,
      category: s.category,
      embedding: input.vectors.get(s.id) ?? [],
      urgencyScore: s.urgencyScore,
      willingnessToPayScore: s.willingnessToPayScore,
      confidence: s.confidence,
      sourceKeys: sources.map((src) => `${src.connectorId}:${src.sourceName}`),
      countries: sources.map((src) => src.country).filter((c): c is string => Boolean(c)),
      languages: sources.map((src) => src.language).filter((l): l is string => Boolean(l)),
      observedAt: sources.map((src) => src.publishedAt).filter((d): d is string => Boolean(d)),
    };
  });
  const drafts = clusterSignals(clusterable, {
    threshold: ctx.options.clusterThreshold,
    now: ctx.clock.now().toISOString(),
  });
  const byId = new Map(input.signals.map((s) => [s.id, s]));
  const now = ctx.clock.now().toISOString();

  const rows: NewCluster[] = [];
  for (const d of drafts) {
    {
      const members = d.signalIds.map((id) => byId.get(id)!);
      const evidence = [...new Set(members.flatMap((m) => m.evidenceIds))]
        .map((id) => input.evidence.get(id))
        .filter((e): e is Evidence => Boolean(e));
      let naming = nameClusterHeuristically({
        dominantType: d.dominantType,
        problems: members.map((m) => m.problem),
        sourceCount: d.sourceCount,
      });
      let namingMethod: "rule" | "ai" = "rule";
      // LLM naming only for multi-signal clusters, within budget and call limits.
      if (ctx.ai?.isLLM && input.runner && members.length >= 2) {
        const ai = ctx.ai;
        const out = await input.runner.run({
          agentName: CLUSTER_NAMER,
          provider: ai.id,
          model: ai.model,
          input: { signalIds: d.signalIds },
          estimateUsd: ai.estimateCost(members.reduce((n, m) => n + m.problem.length, 300), 400),
          researchRunId: input.runId,
          execute: async () => {
            const r = await nameClusterWithLLM(ai, members.map((m) => m.problem));
            return { output: r.naming, ...r.llm };
          },
        });
        if (out.status === "SUCCEEDED") {
          naming = { name: `${SIGNAL_TYPE_LABEL_JA[d.dominantType]}: ${out.output.name}`.slice(0, 120), summary: out.output.summary };
          namingMethod = "ai";
        }
      }
      rows.push({
        researchRunId: input.runId,
        name: naming.name,
        summary: naming.summary,
        signalCount: d.signalCount,
        sourceCount: d.sourceCount,
        countries: d.countries,
        languages: d.languages,
        firstSeen: d.firstSeen,
        lastSeen: d.lastSeen,
        momentum: d.momentum,
        painScore: d.painScore,
        paySignalScore: d.paySignalScore,
        confidence: assessConfidence(evidence, input.sourceItems, input.qualityOf, now).level,
        namingMethod,
        signalIds: d.signalIds,
        centroid: d.centroid,
        similarities: d.similarities,
      });
    }
  }
  return ctx.repos.signals.insertClusters(rows);
}
