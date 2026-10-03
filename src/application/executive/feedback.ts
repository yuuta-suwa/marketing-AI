import type { AppContext } from "@/application/context";
import type { FeedbackMetric, LineageRow, StoredFeedback } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";
import { DomainError } from "@/domain/shared/errors";

/** Real-world outcome (customer response, conversion, revenue, retention, churn…) back to the opportunity. */
export async function recordFeedback(
  ctx: AppContext,
  input: { opportunityId: string; experimentId?: string; metric: FeedbackMetric; value?: number; unit?: string; note?: string; occurredAt?: string },
): Promise<StoredFeedback> {
  authorize(ctx.actor, "opportunity.update");
  if (input.value === undefined && !input.note?.trim()) throw new DomainError("VALIDATION", "数値かメモのどちらかを入力してください");
  if ((input.metric === "CONVERSION" || input.metric === "RETENTION" || input.metric === "CHURN") && input.value !== undefined && (input.value < 0 || input.value > 1)) {
    throw new DomainError("VALIDATION", "率は0〜1で入力してください");
  }
  const row = await ctx.repos.executive.recordFeedback({ ...input, occurredAt: input.occurredAt ?? ctx.clock.now().toISOString() });
  await ctx.repos.ops.audit("feedback.recorded", "opportunity", input.opportunityId, { metric: input.metric });
  return row;
}

/** Signal → Opportunity → Experiment → Revenue dataset (CSV) for learning which signals pay off. */
export async function lineageCsv(ctx: AppContext): Promise<string> {
  authorize(ctx.actor, "research.read");
  const rows = await ctx.repos.executive.listLineage();
  const cols: Array<keyof LineageRow> = ["opportunityId", "title", "status", "scoreTotal", "confidence", "signalCount", "evidenceCount", "experimentCount", "experimentsPositive", "revenueTotal", "feedbackCount"];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralize spreadsheet formula injection and quote.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
