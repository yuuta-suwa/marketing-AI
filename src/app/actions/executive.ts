"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { enforceRateLimit, type RateLimitBucket } from "@/application/rate-limit";
import { openAdvisorCouncil } from "@/application/executive/council";
import { recordFeedback } from "@/application/executive/feedback";
import { handleFridayCommand } from "@/application/executive/friday-command";
import { exportClaudeCodePrompt, generatePocSpecReport } from "@/application/executive/poc";
import { publishDailyBrief } from "@/application/executive/daily-brief";
import { addWatch, checkWatchlists } from "@/application/executive/watchlist";
import { FEEDBACK_METRICS, WATCH_TARGETS } from "@/application/ports/repositories";
import { buildAppContext, requireSession } from "@/infrastructure/server-context";
import { toActionError, type ActionState } from "./result";

const Id = z.uuid();
const ctxOf = async (bucket?: RateLimitBucket) => {
  const ctx = buildAppContext(await requireSession());
  if (bucket) await enforceRateLimit(ctx, bucket);
  return ctx;
};

export type FridayChatState = ActionState & { reply?: { intent: string; message: string; link?: { href: string; label: string } }; echo?: string };

export async function fridayCommandAction(_p: FridayChatState, f: FormData): Promise<FridayChatState> {
  const text = String(f.get("text") ?? "").trim().slice(0, 2000);
  try {
    if (!text) return { ok: false, message: "コマンドを入力してください" };
    const opportunityId = f.get("opportunityId") ? Id.parse(f.get("opportunityId")) : undefined;
    const reply = await handleFridayCommand(await ctxOf("friday.command"), { text, opportunityId });
    if (reply.background) after(reply.background);
    revalidatePath("/friday");
    return { ok: true, message: "", echo: text, reply: { intent: reply.intent, message: reply.message, link: reply.link } };
  } catch (e) {
    return { ...toActionError(e), echo: text };
  }
}

export async function councilAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = Id.parse(f.get("opportunityId"));
    const s = await openAdvisorCouncil(await ctxOf("analysis.run"), id);
    revalidatePath("/friday");
    revalidatePath(`/opportunities/${id}`);
    return { ok: true, message: `顧問会議: ${s.consensus}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function pocSpecAction(_p: ActionState, f: FormData): Promise<ActionState> {
  let reportId: string;
  try {
    const id = Id.parse(f.get("opportunityId"));
    const kind = f.get("kind") === "export" ? "export" : "spec";
    const ctx = await ctxOf("report.generate");
    reportId = (kind === "export" ? await exportClaudeCodePrompt(ctx, id) : await generatePocSpecReport(ctx, id)).id;
  } catch (e) {
    return toActionError(e);
  }
  redirect(`/reports/${reportId}`);
}

export async function watchAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const targetType = z.enum(WATCH_TARGETS).parse(f.get("targetType"));
    const w = await addWatch(await ctxOf(), {
      targetType,
      targetId: f.get("targetId") ? Id.parse(f.get("targetId")) : undefined,
      query: String(f.get("query") ?? "") || undefined,
      label: String(f.get("label") ?? "") || undefined,
    });
    revalidatePath("/watchlists");
    return { ok: true, message: `ウォッチを追加しました（${w.label ?? w.targetType}）` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function checkNowAction(): Promise<ActionState> {
  try {
    const ctx = await ctxOf("analysis.run");
    const r = await checkWatchlists(ctx);
    const brief = await publishDailyBrief(ctx);
    revalidatePath("/watchlists");
    revalidatePath("/dashboard");
    return { ok: true, message: `${r.checked}件をチェック・通知 ${r.notified}件${brief ? "・今日のブリーフを保存" : ""}` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function markReadAction(f: FormData): Promise<void> {
  const ctx = await ctxOf();
  await ctx.repos.executive.markNotificationRead(Id.parse(f.get("notificationId")));
  revalidatePath("/watchlists");
  revalidatePath("/dashboard");
}

export async function feedbackAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const opportunityId = Id.parse(f.get("opportunityId"));
    const raw = String(f.get("value") ?? "").trim();
    await recordFeedback(await ctxOf(), {
      opportunityId,
      experimentId: f.get("experimentId") ? Id.parse(f.get("experimentId")) : undefined,
      metric: z.enum(FEEDBACK_METRICS).parse(f.get("metric")),
      value: raw === "" ? undefined : z.coerce.number().finite().parse(raw),
      unit: String(f.get("unit") ?? "").slice(0, 40) || undefined,
      note: String(f.get("note") ?? "").slice(0, 4000) || undefined,
    });
    revalidatePath(`/opportunities/${opportunityId}`);
    return { ok: true, message: "結果を記録しました" };
  } catch (e) {
    return toActionError(e);
  }
}
