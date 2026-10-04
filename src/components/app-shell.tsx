import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions/auth";

const NAV = [
  { href: "/dashboard", label: "ホーム", icon: "◎" },
  { href: "/research/new", label: "調査", icon: "＋" },
  { href: "/opportunities", label: "機会", icon: "◆" },
  { href: "/friday", label: "FRIDAY", icon: "✦" },
  { href: "/settings/connectors", label: "設定", icon: "⚙" },
];

export function AppShell({ children, mode, email, mock = false }: { children: ReactNode; mode: "supabase" | "demo"; email: string | null; mock?: boolean }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      {mock ? (
        <div className="sticky top-0 z-20 bg-fuchsia-600 px-4 py-1 text-center text-xs font-bold text-white" data-testid="mock-badge" role="status">
          MOCK CONNECTORS — 収集データは合成サンプルです（[MOCK]表示）。実際の市場調査ではありません
        </div>
      ) : null}
      {mode === "demo" ? (
        <div className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-black" data-testid="demo-banner">
          DEMO MODE — データはこのサーバープロセス内にのみ保存されます（本番利用不可）
        </div>
      ) : null}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
        <Link href="/dashboard" className="text-sm font-black tracking-widest">MARKET RADAR <span className="text-accent">OS</span></Link>
        <form action={signOutAction} className="flex items-center gap-2">
          {email ? <span className="hidden max-w-40 truncate text-xs text-muted sm:inline">{email}</span> : null}
          <button className="text-xs text-muted underline-offset-2 hover:underline" type="submit">ログアウト</button>
        </form>
      </header>
      <main className="flex-1 px-4 pb-28 pt-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label="メイン">
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link href={n.href} className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] text-muted hover:text-fg">
                <span aria-hidden className="text-lg leading-none">{n.icon}</span>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
