"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingLabel, variant = "primary", name, value }: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-accent text-white hover:opacity-90",
    secondary: "border border-line bg-surface hover:bg-zinc-50 dark:hover:bg-zinc-800",
    danger: "border border-red-300 bg-surface text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950",
  };
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-60 ${styles[variant]}`}
    >
      {pending ? (pendingLabel ?? "処理中…") : children}
    </button>
  );
}
