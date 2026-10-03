import type { ConnectorRunRecord, ConnectorSetting } from "@/application/ports/repositories";
import type { AppContext } from "@/application/context";
import { evaluateConnectorGate } from "@/domain/compliance/compliance";
import { ConnectorError, type MarketConnector } from "@/domain/connector/connector";
import type { BudgetTracker } from "@/domain/cost/budget";
import type { ResearchDirective } from "@/domain/research/directive";
import { RawSourceItemSchema, type RawSourceItem } from "@/domain/source/source-item";

export type ConnectorOutcome = {
  connector: MarketConnector;
  status: ConnectorRunRecord["status"];
  items: RawSourceItem[];
  error?: string;
  retryCount: number;
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
    return preferred.size === 0 || preferred.has(c.id);
  });
}

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
    settings: ConnectorSetting[];
    budget: BudgetTracker;
  },
): Promise<ConnectorOutcome[]> {
  const settings = new Map(input.settings.map((s) => [s.connectorKey, s]));
  const candidates = selectConnectors(ctx.connectors.list(), input.directive, (input.manualItems?.length ?? 0) > 0);
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
      for (;;) {
        const controller = new AbortController();
        try {
          const raw = await withTimeout(
            connector.search(input.directive, {
              researchRunId: input.runId,
              organizationId: ctx.actor.organizationId,
              limit: connector.id === "manual_import" ? input.directive.maxItems : perConnectorLimit,
              signal: controller.signal,
              manualItems: input.manualItems,
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
          return finish({
            connector,
            status: invalid > 0 ? "PARTIAL" : "SUCCESS",
            items: valid,
            error: invalid > 0 ? `${invalid} item(s) failed validation` : undefined,
            retryCount,
          });
        } catch (e) {
          const retryable = e instanceof ConnectorError ? e.retryable : true;
          if (retryable && retryCount < ctx.options.connectorMaxRetries) {
            retryCount++;
            continue;
          }
          return finish({
            connector,
            status: "FAILED",
            items: [],
            error: e instanceof Error ? e.message : String(e),
            retryCount,
          });
        }
      }
    }),
  );
}
