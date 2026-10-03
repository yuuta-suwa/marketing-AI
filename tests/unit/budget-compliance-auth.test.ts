import { describe, expect, it } from "vitest";
import { authorize, can, type Actor } from "@/domain/auth/authorization";
import { effectiveComplianceStatus, evaluateConnectorGate, type ComplianceProfile } from "@/domain/compliance/compliance";
import { BudgetTracker, checkBudget } from "@/domain/cost/budget";

describe("budget enforcement", () => {
  const limits = { perRunUsd: 1, dailyUsd: 5, monthlyUsd: 50 };

  it("allows spend within all limits", () => {
    const d = checkBudget(limits, { runUsd: 0.2, dailyUsd: 1, monthlyUsd: 10 }, 0.3);
    expect(d.allowed).toBe(true);
  });

  it("stops at the per-run, daily and monthly limits with a user-facing reason", () => {
    const run = checkBudget(limits, { runUsd: 0.9, dailyUsd: 1, monthlyUsd: 1 }, 0.2);
    expect(run).toMatchObject({ allowed: false, scope: "run" });
    const daily = checkBudget(limits, { runUsd: 0, dailyUsd: 4.95, monthlyUsd: 10 }, 0.1);
    expect(daily).toMatchObject({ allowed: false, scope: "daily" });
    const monthly = checkBudget(limits, { runUsd: 0, dailyUsd: 0, monthlyUsd: 49.99 }, 0.1);
    expect(monthly).toMatchObject({ allowed: false, scope: "monthly" });
    if (!monthly.allowed) expect(monthly.reason).toContain("今月");
  });

  it("tracker accumulates spend within a run", () => {
    const t = new BudgetTracker(limits, { dailyUsd: 0, monthlyUsd: 0 });
    t.record(0.6);
    expect(t.check(0.3).allowed).toBe(true);
    t.record(0.3);
    expect(t.check(0.2).allowed).toBe(false);
    expect(t.spentThisRun).toBeCloseTo(0.9);
  });
});

describe("compliance gate", () => {
  const approved: ComplianceProfile = { status: "APPROVED", accessMethod: "OFFICIAL_API", notes: "", prohibitions: [] };
  const base = { profile: approved, enabled: true, credentialsPresent: true, credentialsRequired: true };

  it("allows an approved, enabled, configured connector", () => {
    expect(evaluateConnectorGate(base).allowed).toBe(true);
  });

  it("blocks pending/disabled compliance", () => {
    for (const status of ["PENDING_REVIEW", "DISABLED_PENDING_COMPLIANCE", "BLOCKED"] as const) {
      expect(evaluateConnectorGate({ ...base, profile: { ...approved, status } })).toMatchObject({ allowed: false, reason: "COMPLIANCE" });
    }
  });

  it("organization overrides can only be stricter", () => {
    expect(effectiveComplianceStatus("PENDING_REVIEW", "APPROVED")).toBe("PENDING_REVIEW");
    expect(effectiveComplianceStatus("APPROVED", "BLOCKED")).toBe("BLOCKED");
    expect(evaluateConnectorGate({ ...base, orgStatus: "BLOCKED" }).allowed).toBe(false);
  });

  it("blocks disabled connectors and missing credentials", () => {
    expect(evaluateConnectorGate({ ...base, enabled: false })).toMatchObject({ reason: "DISABLED" });
    expect(evaluateConnectorGate({ ...base, credentialsPresent: false })).toMatchObject({ reason: "CREDENTIALS" });
    expect(evaluateConnectorGate({ ...base, credentialsPresent: false, credentialsRequired: false }).allowed).toBe(true);
  });
});

describe("authorization", () => {
  const actor = (role: Actor["role"]): Actor => ({ userId: "u", organizationId: "o1", role });

  it("follows the role hierarchy", () => {
    expect(can(actor("viewer"), "research.read")).toBe(true);
    expect(can(actor("viewer"), "research.create")).toBe(false);
    expect(can(actor("member"), "research.create")).toBe(true);
    expect(can(actor("member"), "connector.configure")).toBe(false);
    expect(can(actor("admin"), "connector.configure")).toBe(true);
    expect(can(actor("admin"), "organization.delete")).toBe(false);
    expect(can(actor("owner"), "organization.delete")).toBe(true);
  });

  it("denies cross-organization access and anonymous users", () => {
    expect(can(actor("owner"), "research.read", "o2")).toBe(false);
    expect(can(null, "research.read")).toBe(false);
    expect(() => authorize(undefined, "research.read")).toThrow(/Authentication/);
    expect(() => authorize(actor("viewer"), "research.create")).toThrow(/Not allowed/);
  });
});
