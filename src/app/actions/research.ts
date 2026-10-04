"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { enforceRateLimit } from "@/application/rate-limit";
import { createResearch, toManualItems } from "@/application/research/create-research";
import { csvToManualItems } from "@/application/research/csv-import";
import { parseManualInput } from "@/application/research/manual-input";
import { runResearchPipeline } from "@/application/research/pipeline";
import { ResearchRequestSchema } from "@/domain/research/directive";
import { DomainError } from "@/domain/shared/errors";
import { buildAppContext, requireSession } from "@/infrastructure/server-context";
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
 * Creates the directive + run, then executes the pipeline after the
 * response so the phone gets the run page immediately (it polls status).
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
    const manualItems = toManualItems(request.manualItems);
    const manualUrls = request.manualUrls;
    after(async () => {
      await runResearchPipeline(ctx, run.id, { manualItems, manualUrls });
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/research/runs");
  redirect(`/research/runs/${runId}`);
}
