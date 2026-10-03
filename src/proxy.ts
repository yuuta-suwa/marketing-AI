import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/infrastructure/supabase/proxy-session";

const PUBLIC_PATHS = ["/login", "/auth", "/offline.html", "/manifest.webmanifest", "/sw.js"];

/**
 * Refreshes the auth cookie and redirects anonymous visitors to /login.
 * This is an optimistic check only — every page/action re-verifies the
 * session server-side and RLS enforces data access.
 */
export async function proxy(request: NextRequest) {
  const { response, userId } = await refreshSupabaseSession(request);
  const path = request.nextUrl.pathname;
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (supabaseConfigured && !userId && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192.png|icon-512.png).*)"],
};
