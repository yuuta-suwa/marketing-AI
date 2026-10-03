"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createResearch, toManualItems } from "@/application/research/create-research";
import { parseManualInput } from "@/application/research/manual-input";
import { runResearchPipeline } from "@/application/research/pipeline";
import { ResearchRequestSchema } from "@/domain/research/directive";
import { buildAppContext, requireSession } from "@/infrastructure/server-context";
import { toActionError, type ActionState } from "./result";

/**
 * Creates the directive + run, then executes the pipeline after the
 * response so the phone gets the run page immediately (it polls status).
 */
export async function startResearchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let runId: string;
  try {
    const session = await requireSession();
    const ctx = buildAppContext(session);
    const manualText = String(formData.get("manual") ?? "");
    const request = ResearchRequestSchema.parse({
      input: String(formData.get("input") ?? ""),
      deepResearch: formData.get("deepResearch") === "on",
      maxItems: formData.get("maxItems") ? Number(formData.get("maxItems")) : undefined,
      manualItems: manualText.trim() ? parseManualInput(manualText) : undefined,
    });
    const { run } = await createResearch(ctx, request);
    runId = run.id;
    const manualItems = toManualItems(request.manualItems);
    after(async () => {
      await runResearchPipeline(ctx, run.id, { manualItems });
    });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath("/research/runs");
  redirect(`/research/runs/${runId}`);
}
