"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { enforceRateLimit } from "@/application/rate-limit";
import { createResearch, toManualItems } from "@/application/research/create-research";
import { csvToManualItems } from "@/application/research/csv-import";
import { parseManualInput } from "@/application/research/manual-input";
import { dispatchResearch } from "@/application/research/dispatch";
import { requestResearchCancellation } from "@/application/research/cancel";
import { recordQualityReview } from "@/application/golden/review";
import { REVIEW_DECISIONS } from "@/application/ports/repositories";
import { z } from "zod";
import { ResearchRequestSchema } from "@/domain/research/directive";
import { DomainError } from "@/domain/shared/errors";
import { buildAppContext, requireSession } from "@/infrastructure/server-context";
import { kickEmbeddedWorker } from "@/infrastructure/worker/embedded";
import { toActionError, type ActionState } from "./result";

const MAX_CSV_BYTES = 1_000_000;

async function readManualInputs(formData: FormData) {
  const items = [];
  const manualText = String(formData.get("manual") ?? "");
  if (manualText.trim()) items.push(...parseManualInput(manualText));
  const csv = formData.get("csv");
  if (csv instanceof File && csv.size > 0) {
    if (csv.size > MAX_CSV_BYTES) throw new DomainError("VALIDATION", "CSVは1MBまでです");
    const result = csvToManualItems(await csv.text(), csv.name.slice(0, 100));
    if (result.items.length === 0) throw new DomainError("VALIDATION", result.errors[0] ?? "CSVに取り込める行がありません");
    items.push(...result.items);
  }
  const urls = String(formData.get("urls") ?? "")
    .split(/\s+/)
    .map((u) => u.trim())
    .filter(Boolean);
  return { items: items.slice(0, 200), urls };
}

/**
 * Creates the directive + run and ENQUEUES the work, then redirects to the
 * run page at once. The request never executes the research itself: the
 * background worker does (progress arrives via Realtime / polling).
 */
export async function startResearchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let runId: string;
  try {
    const session = await requireSession();
    const ctx = buildAppContext(session);
    await enforceRateLimit(ctx, "research.start");
    const manual = await readManualInputs(formData);
    if (manual.urls.length > 0) await enforceRateLimit(ctx, "url.import");
    const country = String(formData.get("country") ?? "");
    const language = String(formData.get("language") ?? "");
    const request = ResearchRequestSchema.parse({
      input: String(formData.get("input") ?? ""),
      deepResearch: formData.get("deepResearch") === "on",
      maxItems: formData.get("maxItems") ? Number(formData.get("maxItems")) : undefined,
      budgetLimitUsd: formData.get("budget") ? Number(formData.get("budget")) : undefined,
      countries: country ? [country] : undefined,
      languages: language ? [language] : undefined,
      timeRangePreset: formData.get("timeRange") || undefined,
      sourcePreferences: formData.getAll("sources").map(String).filter(Boolean),
      manualItems: manual.items.length ? manual.items : undefined,
      manualUrls: manual.urls.length ? manual.urls : undefined,
    });
    const { run } = await createResearch(ctx, request);
    runId = run.id;
    await dispatchResearch(ctx, run.id, { manualItems: toManualItems(request.manualItems), manualUrls: request.manualUrls });
    kickEmbeddedWorker(); // development only; production relies on the external worker
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/research/runs");
  redirect(`/research/runs/${runId}`);
}

/** The approved way to stop a run (members never update run status directly). */
export async function cancelResearchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const runId = z.uuid().parse(formData.get("runId"));
    const ctx = buildAppContext(await requireSession());
    const status = await requestResearchCancellation(ctx, runId);
    revalidatePath(`/research/runs/${runId}`);
    return { ok: true, message: status === "CANCELLING" ? "キャンセルを要求しました（処理中のステップの終了後に停止します）" : "調査をキャンセルしました" };
  } catch (e) {
    return toActionError(e);
  }
}

const ReviewSchema = z.object({
  researchRunId: z.uuid(),
  entityType: z.enum(["SIGNAL", "OPPORTUNITY"]),
  entityId: z.uuid(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  decision: z.enum(REVIEW_DECISIONS).optional(),
  useful: z.enum(["yes", "no"]).optional(),
  note: z.string().max(2000).optional(),
});

/** Human quality review (Golden Run review table / KPI baseline). Humans only — never generated. */
export async function qualityReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const input = ReviewSchema.parse({
      researchRunId: formData.get("researchRunId"),
      entityType: formData.get("entityType"),
      entityId: formData.get("entityId"),
      rating: formData.get("rating") || undefined,
      decision: formData.get("decision") || undefined,
      useful: formData.get("useful") || undefined,
      note: formData.get("note") || undefined,
    });
    const ctx = buildAppContext(await requireSession());
    await recordQualityReview(ctx, {
      researchRunId: input.researchRunId,
      entityType: input.entityType,
      entityId: input.entityId,
      rating: input.rating ?? null,
      decision: input.decision,
      useful: input.useful === undefined ? undefined : input.useful === "yes",
      note: input.note,
    });
    revalidatePath(`/research/runs/${input.researchRunId}`);
    return { ok: true, message: "評価を保存しました" };
  } catch (e) {
    return toActionError(e);
  }
}
