import { redirect } from "next/navigation";
import { connection } from "next/server";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/infrastructure/server-context";
import { runtimeMode } from "@/infrastructure/runtime-mode";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Always request-time: auth and tenant data must never be prerendered.
  await connection();
  if (runtimeMode() === "unconfigured") redirect("/login");
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <AppShell mode={session.mode} email={session.email}>
      {children}
    </AppShell>
  );
}
