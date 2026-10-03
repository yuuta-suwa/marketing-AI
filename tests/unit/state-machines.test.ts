import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertOpportunityTransition,
  canTransitionOpportunity,
  OPPORTUNITY_STATUSES,
} from "@/domain/opportunity/status";
import {
  assertRunTransition,
  canTransitionRun,
  RESEARCH_RUN_STATUSES,
} from "@/domain/research/run-state-machine";

const sql = readFileSync(join(__dirname, "../../supabase/migrations/20261003000300_integrity.sql"), "utf8");

/** Parses `when from_status = 'X' then to_status in ('A', 'B')` lines of a SQL function. */
function sqlMatrix(fnName: string): Map<string, string[]> {
  const body = sql.slice(sql.indexOf(fnName), sql.indexOf("$$;", sql.indexOf(fnName)));
  const map = new Map<string, string[]>();
  for (const m of body.matchAll(/when from_status = '(\w+)' then to_status (?:in \(([^)]*)\)|= '(\w+)')/g)) {
    const targets = m[2] ? [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [m[3]];
    map.set(m[1], targets);
  }
  return map;
}

describe("research run state machine", () => {
  it("allows the happy path", () => {
    const path = ["DRAFT", "QUEUED", "COLLECTING", "NORMALIZING", "EXTRACTING", "CLUSTERING", "ANALYZING", "VALIDATING", "COMPLETED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransitionRun(path[i], path[i + 1])).toBe(true);
  });

  it("forbids skipping, going backwards and leaving terminal states", () => {
    expect(canTransitionRun("DRAFT", "COMPLETED")).toBe(false);
    expect(canTransitionRun("COLLECTING", "QUEUED")).toBe(false);
    expect(canTransitionRun("COMPLETED", "FAILED")).toBe(false);
    expect(canTransitionRun("FAILED", "QUEUED")).toBe(false);
    expect(() => assertRunTransition("QUEUED", "ANALYZING")).toThrow(/Illegal/);
  });

  it("lets any active state fail or be cancelled, and stages end as PARTIAL_SUCCESS", () => {
    for (const s of ["QUEUED", "COLLECTING", "EXTRACTING", "VALIDATING"] as const) {
      expect(canTransitionRun(s, "FAILED")).toBe(true);
      expect(canTransitionRun(s, "CANCELLED")).toBe(true);
    }
    expect(canTransitionRun("EXTRACTING", "PARTIAL_SUCCESS")).toBe(true);
  });

  it("matches the SQL trigger matrix exactly", () => {
    const matrix = sqlMatrix("research_run_transition_allowed");
    for (const from of RESEARCH_RUN_STATUSES) {
      for (const to of RESEARCH_RUN_STATUSES) {
        if (from === to) continue;
        const terminal = ["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"].includes(from);
        const sqlAllowed = terminal ? false : to === "FAILED" || to === "CANCELLED" || (matrix.get(from) ?? []).includes(to);
        expect([from, to, canTransitionRun(from, to)]).toEqual([from, to, sqlAllowed]);
      }
    }
  });
});

describe("opportunity decision gates", () => {
  it("matches the SQL trigger matrix exactly", () => {
    const matrix = sqlMatrix("opportunity_transition_allowed");
    for (const from of OPPORTUNITY_STATUSES) {
      for (const to of OPPORTUNITY_STATUSES) {
        if (from === to) continue;
        expect([from, to, canTransitionOpportunity(from, to)]).toEqual([from, to, (matrix.get(from) ?? []).includes(to)]);
      }
    }
  });

  it("requires evidence before VALIDATED", () => {
    expect(() => assertOpportunityTransition("DISCOVERED", "VALIDATED", { evidenceCount: 0, humanDecisionRecorded: true })).toThrow(/evidence/);
  });

  it("requires a human decision for PoC and experiment approvals", () => {
    const ctx = { evidenceCount: 3, humanDecisionRecorded: false };
    expect(() => assertOpportunityTransition("EXPERIMENT_PROPOSED", "EXPERIMENT_APPROVED", ctx)).toThrow(/human/);
    expect(() => assertOpportunityTransition("POC_PROPOSED", "POC_APPROVED", ctx)).toThrow(/human/);
    expect(() => assertOpportunityTransition("POC_APPROVED", "LAUNCHED", ctx)).toThrow(/human/);
    expect(() => assertOpportunityTransition("POC_PROPOSED", "POC_APPROVED", { ...ctx, humanDecisionRecorded: true })).not.toThrow();
  });

  it("forbids skipping the PoC gates", () => {
    expect(canTransitionOpportunity("DISCOVERED", "POC_APPROVED")).toBe(false);
    expect(canTransitionOpportunity("EXPERIMENT_APPROVED", "LAUNCHED")).toBe(false);
  });
});
