import { NextResponse, type NextRequest } from "next/server";
import { proxyDecision } from "@/lib/auth-guard";
import { refreshSupabaseSession } from "@/infrastructure/supabase/proxy-session";

/**
 * Refreshes the auth cookie and redirects anonymous visitors to /login.
 * This is an optimistic check only — every page/action re-verifies the
 * session server-side and RLS enforces data access.
 */
export async function proxy(request: NextRequest) {
  const { response, userId } = await refreshSupabaseSession(request);
  const decision = proxyDecision({
    path: request.nextUrl.pathname,
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    userId,
  });
  return decision === "login" ? NextResponse.redirect(new URL("/login", request.url)) : response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192.png|icon-512.png).*)"],
};
