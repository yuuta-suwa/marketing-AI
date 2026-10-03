import { DomainError } from "../shared/errors";
import type { PocSpec } from "./poc-spec";

/**
 * Builds a CLAUDE_CODE_BUILD_PROMPT for a NEW repository from an approved
 * PoC spec. Export is refused unless the PoC was approved by a human.
 */
export function buildClaudeCodePrompt(spec: PocSpec, meta: { opportunityId: string; generatedAt: string }): string {
  if (!spec.approved) {
    throw new DomainError("FORBIDDEN", "Claude Code Export は PoC承認（POC_APPROVED）後のみ可能です");
  }
  const s = spec.sections;
  return `# CLAUDE_CODE_BUILD_PROMPT

You are building a new product PoC in an empty repository. Act as a senior full-stack engineer.
Source: MARKET RADAR OS opportunity ${meta.opportunityId} (generated ${meta.generatedAt}).

## Rules
- Build only what is in scope below; Non Goals are out of scope.
- Strict TypeScript, small modules, business logic outside UI components.
- Validate all inputs with Zod. Secrets only in server-side env vars; never in NEXT_PUBLIC_*.
- Row Level Security on every table. Do not use user_metadata for authorization.
- Do not invent market facts in product copy. Evidence below is the only customer data.
- Respect the cost limit. Ask before adding paid services.
- Commit at milestones after lint, typecheck, tests and production build pass.

## Problem
${s.Problem}

## Customer
${s.Customer}

## Evidence (verbatim customer statements)
${s.Evidence}

## Hypothesis
${s.Hypothesis}

## Value Proposition
${s["Value Proposition"]}

## Core Features (scope)
${s["Core Features"]}

## Non Goals
${s["Non Goals"]}

## User Flow
${s["User Flow"]}

## Data Model
${s["Data Model"]}

## API Requirements
${s["API Requirements"]}

## AI Requirements
${s["AI Requirements"]}

## Technical Architecture
${s["Technical Architecture"]}

## Security
${s.Security}

## Metrics
${s.Metrics}

## Experiment
${s.Experiment}

## Cost Limit
${s["Cost Limit"]}

## Kill Criteria
${s["Kill Criteria"]}

## Acceptance Criteria
${s["Acceptance Criteria"]}

## Start
1. Scaffold the project and write docs/ARCHITECTURE.md.
2. Implement the data model with migrations and RLS, with tests.
3. Implement the core feature end to end on mobile.
4. Add metric events for the experiment.
5. Run all checks, then report what was built, how to run it, and what is left.
`;
}
