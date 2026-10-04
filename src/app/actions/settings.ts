"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updateConnectorSetting } from "@/application/settings/connectors";
import { COMPLIANCE_STATUSES } from "@/domain/compliance/compliance";
import { authorize } from "@/domain/auth/authorization";
import { buildAppContext, requireSession } from "@/infrastructure/server-context";
import { kickEmbeddedWorker } from "@/infrastructure/worker/embedded";
import { toActionError, type ActionState } from "./result";

const ConnectorSettingSchema = z.object({
  connectorKey: z.string().regex(/^[a-z0-9_]{2,64}$/),
  enabled: z.boolean(),
  complianceStatus: z.enum(COMPLIANCE_STATUSES).optional(),
  termsNotes: z.string().max(2000).optional(),
});

export async function connectorSettingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const input = ConnectorSettingSchema.parse({
      connectorKey: formData.get("connectorKey"),
      enabled: formData.get("enabled") === "on",
      complianceStatus: formData.get("complianceStatus") || undefined,
      termsNotes: formData.get("termsNotes") || undefined,
    });
    const ctx = buildAppContext(await requireSession());
    const { effectiveStatus } = await updateConnectorSetting(ctx, input);
    revalidatePath("/settings/connectors");
    return { ok: true, message: `保存しました（${effectiveStatus}・${input.enabled ? "有効" : "無効"}）` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Admin: re-queue a dead-lettered job (fresh attempts). Audited. */
export async function requeueJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = buildAppContext(await requireSession());
    authorize(ctx.actor, "job.manage");
    const id = z.uuid().parse(formData.get("jobId"));
    const job = await ctx.repos.jobs.requeueDeadLetter(id);
    await ctx.repos.ops.audit("job.requeued", "job", job.id, { jobType: job.jobType });
    kickEmbeddedWorker();
    revalidatePath("/settings/observability");
    return { ok: true, message: "再キューしました" };
  } catch (e) {
    return toActionError(e);
  }
}
