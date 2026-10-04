import { redirect } from "next/navigation";
import { connection } from "next/server";
import { appAccess } from "@/lib/auth-guard";
import { AppShell } from "@/components/app-shell";
import { getSession, mockConnectorsActive } from "@/infrastructure/server-context";
import { runtimeMode } from "@/infrastructure/runtime-mode";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Always request-time: auth and tenant data must never be prerendered.
  await connection();
  const mode = runtimeMode();
  const session = mode === "unconfigured" ? null : await getSession();
  if (appAccess(mode, Boolean(session)) === "login" || !session) redirect("/login");
  return (
    <AppShell mode={session.mode} email={session.email} mock={mockConnectorsActive()}>
      {children}
    </AppShell>
  );
}
