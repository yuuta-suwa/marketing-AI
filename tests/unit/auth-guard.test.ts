import { describe, expect, it } from "vitest";
import { appAccess, isPublicPath, proxyDecision } from "@/lib/auth-guard";

describe("authentication guard", () => {
  it("redirects anonymous users away from app routes when Supabase is configured", () => {
    for (const path of ["/dashboard", "/opportunities/abc", "/research/new", "/friday", "/settings/connectors"]) {
      expect(proxyDecision({ path, supabaseConfigured: true, userId: null })).toBe("login");
    }
  });

  it("lets anonymous users reach public routes only", () => {
    for (const path of ["/login", "/auth/callback", "/manifest.webmanifest", "/sw.js", "/offline.html"]) {
      expect(isPublicPath(path)).toBe(true);
      expect(proxyDecision({ path, supabaseConfigured: true, userId: null })).toBe("next");
    }
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/authority")).toBe(false);
  });

  it("signed-in users pass", () => {
    expect(proxyDecision({ path: "/dashboard", supabaseConfigured: true, userId: "u1" })).toBe("next");
    expect(appAccess("supabase", true)).toBe("allow");
  });

  it("the app shell never renders without a verified session or configuration", () => {
    expect(appAccess("unconfigured", true)).toBe("login");
    expect(appAccess("supabase", false)).toBe("login");
    expect(appAccess("demo", true)).toBe("allow");
  });
});
