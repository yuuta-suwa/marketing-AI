import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/forms/login-form";
import { Notice } from "@/components/ui";
import { runtimeMode } from "@/infrastructure/runtime-mode";
import { validateEnvironment } from "@/infrastructure/env-contract";

export const metadata = { title: "ログイン" };

export default async function LoginPage() {
  await connection();
  const mode = runtimeMode();
  if (mode === "demo") redirect("/dashboard");
  // Names of misconfigured variables only — never values.
  const envErrors = mode === "unconfigured" ? validateEnvironment("web").errors : [];
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <p className="text-sm font-black tracking-widest">MARKET RADAR <span className="text-accent">OS</span></p>
        <h1 className="mt-2 text-2xl font-bold">市場の「困った」から事業機会を。</h1>
        <p className="mt-2 text-sm text-muted">証拠付きで未充足需要を発見し、収益化可能な事業仮説へ。</p>
      </div>
      {mode === "unconfigured" ? (
        <Notice tone="warn">
          Supabaseが未設定です。NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY を設定してください（ローカル検証は MRO_DEMO_MODE=true、本番では無効）。
          {envErrors.length > 0 ? (
            <ul className="mt-2 list-disc pl-4 text-xs" data-testid="env-errors">
              {envErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : (
        <LoginForm />
      )}
    </main>
  );
}
