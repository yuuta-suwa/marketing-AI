import type { BudgetTracker } from "@/domain/cost/budget";
import type { TokenUsage } from "@/domain/agent/ai-provider";
import type { Logger } from "@/lib/logger";
import type { RunCounter } from "./limits";
import type { OpsRepository } from "./ports/repositories";

export type AgentExecution<T> = {
  output: T;
  usage: TokenUsage;
  costUsd: number;
  provider: string;
  model: string;
};

export type AgentOutcome<T> =
  | { status: "SUCCEEDED"; output: T; agentRunId: string; costUsd: number }
  | { status: "SKIPPED_BUDGET"; reason: string; agentRunId: string }
  | { status: "SKIPPED_LIMIT"; reason: string }
  | { status: "FAILED"; error: string; agentRunId: string };

export type AgentCall<T> = {
  agentName: string;
  provider: string;
  model: string;
  input: unknown;
  /** Upper-bound cost estimate checked against the budget before running. */
  estimateUsd: number;
  researchRunId?: string;
  opportunityId?: string;
  execute: () => Promise<AgentExecution<T>>;
};

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * Every agent invocation goes through here. It enforces:
 *   * an explicit per-agent call limit (no unbounded autonomous loops),
 *   * the budget (checked before the call, recorded after),
 *   * an agent_runs log row and a cost_ledger row per call,
 *   * no silent failures (errors are logged, persisted and returned).
 */
export class AgentRunner {
  private readonly calls = new Map<string, number>();

  constructor(
    private readonly deps: {
      ops: OpsRepository;
      budget: BudgetTracker;
      logger: Logger;
      maxCallsPerAgent: number;
      /** Run-wide cap on paid model calls (MAX_LLM_CALLS_PER_RUN). Heuristic agents are free and exempt. */
      llmCalls?: RunCounter;
    },
  ) {}

  /** Hard-limit stops that happened in this runner (for the run's explanation). */
  readonly limitStops: string[] = [];

  private async auditRun(call: AgentCall<unknown>, agentRunId: string, status: string, costUsd = 0): Promise<void> {
    try {
      await this.deps.ops.audit("agent.executed", "agent_run", agentRunId, {
        agent: call.agentName,
        status,
        provider: call.provider,
        costUsd,
        researchRunId: call.researchRunId,
        opportunityId: call.opportunityId,
      });
    } catch (e) {
      // The agent_runs row is the primary record; an audit write failure is logged, not fatal.
      this.deps.logger.error("audit.failed", { agent: call.agentName, error: (e as Error).message });
    }
  }

  async run<T>(call: AgentCall<T>): Promise<AgentOutcome<T>> {
    const used = this.calls.get(call.agentName) ?? 0;
    if (used >= this.deps.maxCallsPerAgent) {
      const reason = `${call.agentName}: call limit ${this.deps.maxCallsPerAgent} reached`;
      this.deps.logger.warn("agent.limit", { agent: call.agentName, status: "SKIPPED_LIMIT" });
      return { status: "SKIPPED_LIMIT", reason };
    }
    if (call.provider !== "heuristic" && this.deps.llmCalls && !this.deps.llmCalls.tryTake()) {
      const reason = this.deps.llmCalls.stopReason;
      if (!this.limitStops.includes(reason)) this.limitStops.push(reason);
      this.deps.logger.warn("agent.run_limit", { agent: call.agentName, status: "SKIPPED_LIMIT" });
      return { status: "SKIPPED_LIMIT", reason };
    }
    this.calls.set(call.agentName, used + 1);

    const record = await this.deps.ops.startAgentRun({
      agentName: call.agentName,
      provider: call.provider,
      model: call.model,
      inputJson: call.input,
      researchRunId: call.researchRunId,
      opportunityId: call.opportunityId,
    });
    const started = Date.now();

    const budget = this.deps.budget.check(call.estimateUsd);
    if (!budget.allowed) {
      await this.deps.ops.finishAgentRun(record.id, {
        status: "SKIPPED_BUDGET",
        error: budget.reason,
        durationMs: 0,
      });
      this.deps.logger.warn("agent.budget_stop", { agent: call.agentName, status: "SKIPPED_BUDGET" });
      await this.auditRun(call, record.id, "SKIPPED_BUDGET");
      return { status: "SKIPPED_BUDGET", reason: budget.reason, agentRunId: record.id };
    }

    try {
      const result = await call.execute();
      const durationMs = Date.now() - started;
      this.deps.budget.record(result.costUsd);
      if (result.costUsd > 0) {
        await this.deps.ops.recordCost({
          category: "AI",
          provider: result.provider,
          model: result.model,
          agentName: call.agentName,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          amountUsd: result.costUsd,
          researchRunId: call.researchRunId,
          agentRunId: record.id,
        });
      }
      await this.deps.ops.finishAgentRun(record.id, {
        status: "SUCCEEDED",
        outputJson: result.output,
        tokenUsage: result.usage ?? ZERO_USAGE,
        estimatedCost: result.costUsd,
        durationMs,
      });
      this.deps.logger.info("agent.succeeded", {
        agent: call.agentName,
        duration_ms: durationMs,
        token_count: result.usage.inputTokens + result.usage.outputTokens,
        cost_usd: result.costUsd,
        status: "SUCCEEDED",
      });
      await this.auditRun(call, record.id, "SUCCEEDED", result.costUsd);
      return { status: "SUCCEEDED", output: result.output, agentRunId: record.id, costUsd: result.costUsd };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.deps.ops.finishAgentRun(record.id, {
        status: "FAILED",
        error,
        durationMs: Date.now() - started,
      });
      this.deps.logger.error("agent.failed", { agent: call.agentName, error, status: "FAILED" });
      await this.auditRun(call, record.id, "FAILED");
      return { status: "FAILED", error, agentRunId: record.id };
    }
  }
}
