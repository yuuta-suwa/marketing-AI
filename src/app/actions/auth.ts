"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { runtimeMode } from "@/infrastructure/runtime-mode";
import { createSupabaseServerClient } from "@/infrastructure/supabase/server-client";
import type { ActionState } from "./result";

const Credentials = z.object({
  email: z.email("メールアドレスを確認してください"),
  password: z.string().min(8, "パスワードは8文字以上です").max(200),
});

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (runtimeMode() !== "supabase") redirect("/dashboard");
  const parsed = Credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const supabase = await createSupabaseServerClient();
  const mode = formData.get("mode") === "signup" ? "signup" : "signin";
  const { error } =
    mode === "signup" ? await supabase.auth.signUp(parsed.data) : await supabase.auth.signInWithPassword(parsed.data);
  // Do not reveal whether an account exists.
  if (error) return { ok: false, message: mode === "signup" ? "登録できませんでした" : "メールアドレスまたはパスワードが正しくありません" };
  if (mode === "signup") return { ok: true, message: "確認メールを送信しました（設定により即時ログイン）" };
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  if (runtimeMode() === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
