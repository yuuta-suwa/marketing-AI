import type { RuntimeMode } from "@/infrastructure/runtime-mode";

/** Paths reachable without a session. Everything else requires login. */
export const PUBLIC_PATH_PREFIXES = ["/login", "/auth/", "/offline.html", "/manifest.webmanifest", "/sw.js", "/api/cron/"] as const;

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));
}

/** Optimistic edge check used by the proxy (pages still verify server-side). */
export function proxyDecision(input: { path: string; supabaseConfigured: boolean; userId: string | null }): "next" | "login" {
  if (!input.supabaseConfigured) return "next";
  if (input.userId) return "next";
  return isPublicPath(input.path) ? "next" : "login";
}

/** Authoritative check for the authenticated app shell. */
export function appAccess(mode: RuntimeMode, hasSession: boolean): "allow" | "login" {
  if (mode === "unconfigured") return "login";
  return hasSession ? "allow" : "login";
}
