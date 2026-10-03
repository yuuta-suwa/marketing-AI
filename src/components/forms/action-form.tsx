"use client";
import { useActionState, type ReactNode } from "react";
import { INITIAL_ACTION_STATE, type ActionState } from "@/app/actions/result";
import { Notice } from "../ui";

/** Small wrapper: a server action form that shows its result message. */
export function ActionForm({
  action,
  children,
  className = "space-y-2",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className={className}>
      {children}
      {state.message ? <Notice tone={state.ok ? "ok" : "error"}>{state.message}</Notice> : null}
    </form>
  );
}
