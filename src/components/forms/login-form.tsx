"use client";
import { useActionState } from "react";
import { signInAction } from "@/app/actions/auth";
import { INITIAL_ACTION_STATE } from "@/app/actions/result";
import { SubmitButton } from "../submit-button";
import { Notice } from "../ui";

export function LoginForm() {
  const [state, action] = useActionState(signInAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="space-y-3">
      <input name="email" type="email" required autoComplete="email" placeholder="メールアドレス" className="min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base" />
      <input name="password" type="password" required minLength={8} autoComplete="current-password" placeholder="パスワード（8文字以上）" className="min-h-12 w-full rounded-xl border border-line bg-surface px-3 text-base" />
      {state.message ? <Notice tone={state.ok ? "ok" : "error"}>{state.message}</Notice> : null}
      <SubmitButton name="mode" value="signin">ログイン</SubmitButton>
      <SubmitButton name="mode" value="signup" variant="secondary">新規登録</SubmitButton>
    </form>
  );
}
