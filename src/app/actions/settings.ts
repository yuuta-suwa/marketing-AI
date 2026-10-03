"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { updateConnectorSetting } from "@/application/settings/connectors";
import { COMPLIANCE_STATUSES } from "@/domain/compliance/compliance";
import { buildAppContext, requireSession } from "@/infrastructure/server-context";
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
