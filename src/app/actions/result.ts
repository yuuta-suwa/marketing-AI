import { isDomainError } from "@/domain/shared/errors";
import { ZodError } from "zod";

export type ActionState = { ok: boolean; message: string };
export const INITIAL_ACTION_STATE: ActionState = { ok: true, message: "" };

/** User-facing message; internal errors are logged, not leaked. */
export function toActionError(e: unknown): ActionState {
  if (isDomainError(e)) return { ok: false, message: e.message };
  if (e instanceof ZodError) return { ok: false, message: e.issues.map((i) => i.message).join(" / ") };
  console.error(JSON.stringify({ level: "error", msg: "action.failed", error: e instanceof Error ? e.message : String(e) }));
  return { ok: false, message: "処理に失敗しました。時間をおいて再度お試しください。" };
}
