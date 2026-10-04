import type { ConnectorRunRecord, ConnectorSetting } from "@/application/ports/repositories";
import type { AppContext } from "@/application/context";
import { evaluateConnectorGate } from "@/domain/compliance/compliance";
import { classifyConnectorError, type MarketConnector } from "@/domain/connector/connector";
import type { BudgetTracker } from "@/domain/cost/budget";
import type { ResearchDirective } from "@/domain/research/directive";
import { RawSourceItemSchema, type RawSourceItem } from "@/domain/source/source-item";
import type { RunCounter } from "@/application/limits";

export type ConnectorOutcome = {
  connector: MarketConnector;
  status: ConnectorRunRecord["status"];
  items: RawSourceItem[];
  error?: string;
  retryCount: number;
  costUsd?: number;
  /** Set when a hard limit (not a failure) prevented the request. */
  limitStop?: string;
};

/** Which connectors a run should consider. */
export function selectConnectors(
  all: MarketConnector[],
  directive: ResearchDirective,
  hasManualItems: boolean,
): MarketConnector[] {
  const preferred = new Set(directive.sourcePreferences);
  return all.filter((c) => {
    if (c.id === "manual_import") return hasManualItems;
    if (preferred.size > 0) return preferred.has(c.id);
    // Scaffolds without any permitted access method are never candidates by default.
    return c.complianceStatus().status !== "DISABLED_PENDING_COMPLIANCE";
  });
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

async function withTimeout<T>(p: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs eligible connectors in parallel. A failing connector never fails the
 * run: its error is recorded (connector_runs + log) and the run is marked
 * degraded by the caller.
 */
export async function collectSources(
  ctx: AppContext,
  input: {
    runId: string;
    directive: ResearchDirective;
    manualItems?: RawSourceItem[];
    manualUrls?: string[];
    settings: ConnectorSetting[];
    budget: BudgetTracker;
    /** MAX_SEARCH_REQUESTS_PER_RUN: every external request attempt (retries included) takes one. */
    externalRequests?: RunCounter;
  },
): Promise<ConnectorOutcome[]> {
  const settings = new Map(input.settings.map((s) => [s.connectorKey, s]));
  const candidates = selectConnectors(
    ctx.connectors.list(),
    input.directive,
    (input.manualItems?.length ?? 0) + (input.manualUrls?.length ?? 0) > 0,
  );
  const perConnectorLimit = Math.max(1, Math.ceil(input.directive.maxItems / Math.max(1, candidates.length)));

  return Promise.all(
    candidates.map(async (connector): Promise<ConnectorOutcome> => {
      const log = ctx.logger.child({ research_run_id: input.runId, connector: connector.id });
      const started = ctx.clock.now();
      const finish = async (outcome: ConnectorOutcome) => {
        const completed = ctx.clock.now();
        await ctx.repos.ops.recordConnectorRun({
          researchRunId: input.runId,
          connectorKey: connector.id,
          status: outcome.status,
          resultCount: outcome.items.length,
          duplicateCount: 0,
          durationMs: completed.getTime() - started.getTime(),
          retryCount: outcome.retryCount,
          error: outcome.error,
          costUsd: outcome.costUsd ?? 0,
          startedAt: started.toISOString(),
          completedAt: completed.toISOString(),
        });
        await ctx.repos.ops.audit("connector.executed", "research_run", input.runId, {
          connector: connector.id,
          status: outcome.status,
          resultCount: outcome.items.length,
          retryCount: outcome.retryCount,
          error: outcome.error,
        });
        const level = outcome.status === "FAILED" ? "error" : outcome.status === "SKIPPED" ? "warn" : "info";
        log[level]("connector.finished", {
          status: outcome.status,
          result_count: outcome.items.length,
          retry_count: outcome.retryCount,
          duration_ms: completed.getTime() - started.getTime(),
          cost_usd: outcome.costUsd ?? 0,
          error: outcome.error,
        });
        return outcome;
      };

      const setting = settings.get(connector.id);
      const gate = evaluateConnectorGate({
        profile: connector.complianceStatus(),
        orgStatus: setting?.complianceStatus,
        enabled: setting?.enabled ?? connector.enabledByDefault,
        credentialsPresent: connector.credentialsPresent(),
        credentialsRequired: connector.credentialsRequired,
      });
      if (!gate.allowed) {
        return finish({ connector, status: "SKIPPED", items: [], error: gate.message, retryCount: 0 });
      }

      const estimate = connector.estimateCost ? (await connector.estimateCost(input.directive)).amountUsd : 0;
      const budget = input.budget.check(estimate);
      if (!budget.allowed) {
        return finish({ connector, status: "SKIPPED", items: [], error: budget.reason, retryCount: 0 });
      }

      let retryCount = 0;
      const warnings: string[] = [];
      for (;;) {
        // Manual input (pasted text / CSV / user URLs) is not an external search request.
        if (connector.id !== "manual_import" && input.externalRequests && !input.externalRequests.tryTake()) {
          const reason = input.externalRequests.stopReason;
          return finish({ connector, status: retryCount > 0 ? "FAILED" : "SKIPPED", items: [], error: reason, retryCount, limitStop: reason });
        }
        const controller = new AbortController();
        try {
          const raw = await withTimeout(
            connector.search(input.directive, {
              researchRunId: input.runId,
              organizationId: ctx.actor.organizationId,
              limit: connector.id === "manual_import" ? input.directive.maxItems : perConnectorLimit,
              signal: controller.signal,
              manualItems: input.manualItems,
              manualUrls: input.manualUrls,
              warn: (message) => warnings.push(message),
            }),
            ctx.options.connectorTimeoutMs,
            controller,
          );
          if (estimate > 0) {
            input.budget.record(estimate);
            await ctx.repos.ops.recordCost({
              category: connector.category === "WEB" ? "SEARCH_API" : "CONNECTOR",
              provider: connector.id,
              connectorKey: connector.id,
              units: 1,
              amountUsd: estimate,
              researchRunId: input.runId,
            });
          }
          const valid: RawSourceItem[] = [];
          let invalid = 0;
          for (const item of raw) {
            const parsed = RawSourceItemSchema.safeParse(item);
            if (parsed.success) valid.push(parsed.data);
            else invalid++;
          }
          if (invalid > 0) warnings.push(`${invalid} item(s) failed validation`);
          return finish({
            connector,
            status: warnings.length > 0 ? "PARTIAL" : "SUCCESS",
            items: valid,
            error: warnings.length > 0 ? warnings.join(" / ").slice(0, 2000) : undefined,
            retryCount,
            costUsd: estimate,
          });
        } catch (e) {
          const classified = classifyConnectorError(e);
          if (classified.retryable && retryCount < ctx.options.connectorMaxRetries) {
            retryCount++;
            // Bounded exponential backoff; rate limits wait longer. Never bypasses provider limits.
            const base = ctx.options.connectorRetryBaseMs * 2 ** (retryCount - 1);
            await sleep(classified.class === "RATE_LIMITED" ? base * 4 : base);
            continue;
          }
          return finish({
            connector,
            status: "FAILED",
            items: [],
            error: `[${classified.class}] ${e instanceof Error ? e.message : String(e)}`,
            retryCount,
          });
        }
      }
    }),
  );
}
