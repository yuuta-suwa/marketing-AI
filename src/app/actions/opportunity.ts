"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { LocalFridayAdapter } from "@/application/executive/local-friday";
import { ADDITIONAL_RESEARCH_TYPES, startAdditionalResearch } from "@/application/opportunity/additional-research";
import { decideOpportunity } from "@/application/opportunity/decide";
import { runRedTeam } from "@/application/opportunity/red-team";
import { parseManualInput } from "@/application/research/manual-input";
import { OPPORTUNITY_STATUSES } from "@/domain/opportunity/status";
import { buildAppContext, requireSession } from "@/infrastructure/server-context";
import { toActionError, type ActionState } from "./result";

const IdSchema = z.uuid();

export async function redTeamAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const id = IdSchema.parse(formData.get("opportunityId"));
    const ctx = buildAppContext(await requireSession());
    const review = await runRedTeam(ctx, id);
    revalidatePath(`/opportunities/${id}`);
    return { ok: true, message: `Red Team完了: ${review.verdict}` };
  } catch (e) {
    return toActionError(e);
  }
}

const DecisionSchema = z.object({
  opportunityId: IdSchema,
  decision: z.enum(["APPROVE", "REJECT", "HOLD", "WATCH", "REQUEST_RESEARCH"]),
  toStatus: z.enum(OPPORTUNITY_STATUSES).optional(),
  rationale: z.string().max(2000).optional(),
});

export async function decisionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const input = DecisionSchema.parse({
      opportunityId: formData.get("opportunityId"),
      decision: formData.get("decision"),
      toStatus: formData.get("toStatus") || undefined,
      rationale: formData.get("rationale") || undefined,
    });
    const ctx = buildAppContext(await requireSession());
    const { opportunity } = await decideOpportunity(ctx, input);
    revalidatePath(`/opportunities/${input.opportunityId}`);
    return { ok: true, message: `判断を記録しました（${opportunity.status}）` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function additionalResearchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let runId: string;
  try {
    const opportunityId = IdSchema.parse(formData.get("opportunityId"));
    const type = z.enum(ADDITIONAL_RESEARCH_TYPES).parse(formData.get("type"));
    const manual = String(formData.get("manual") ?? "");
    const ctx = buildAppContext(await requireSession());
    const result = await startAdditionalResearch(ctx, {
      opportunityId,
      type,
      note: String(formData.get("note") ?? "").slice(0, 500) || undefined,
      manualItems: manual.trim() ? parseManualInput(manual) : undefined,
    });
    runId = result.runId;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/research/runs/${runId}`);
}

export type FridayState = ActionState & { briefing?: Awaited<ReturnType<LocalFridayAdapter["consult"]>> };

export async function fridayConsultAction(_prev: FridayState, formData: FormData): Promise<FridayState> {
  try {
    const id = IdSchema.parse(formData.get("opportunityId"));
    const friday = new LocalFridayAdapter(buildAppContext(await requireSession()));
    return { ok: true, message: "", briefing: await friday.consult(id) };
  } catch (e) {
    return toActionError(e);
  }
}
