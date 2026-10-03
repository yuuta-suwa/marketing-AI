# FRIDAY Integration

FRIDAY is the **executive interface**, not a chatbot: it routes intent to the research engine and decision gates, summarizes results, and leaves the final decision to a human.

```mermaid
flowchart LR
  User --> FRIDAY
  FRIDAY --> Director[MarketDirector]
  Director --> Agents[AI Agents]
  Agents --> Opp[Opportunity]
  Opp --> FRIDAY
  FRIDAY --> Council[Advisor Council (M3)]
  Council --> Human[Human Decision]
  FRIDAY --> Human
```

## Interface

`src/application/executive/executive-assistant.ts`

```ts
interface ExecutiveAssistantAdapter {
  sendDirective(request): Promise<PipelineResult>
  requestDeepResearch(opportunityId, type, note?): Promise<PipelineResult>
  consult(opportunityId): Promise<ExecutiveBriefing>
  openAdvisorCouncil(opportunityId)
  runRedTeam(opportunityId)
  approveOpportunity(opportunityId, toStatus, rationale?)
  rejectOpportunity(opportunityId, rationale?)
  holdOpportunity(opportunityId, rationale?)
  watchOpportunity(opportunityId, rationale?)
  createExperiment(opportunityId, draft)
  generatePoCSpec(opportunityId)
  exportClaudeCode(opportunityId)
}
```

The spec's parameterless signatures were given explicit inputs (opportunity id, rationale, target status) so calls are auditable.

`LocalFridayAdapter` implements it in-process against the application services. An external FRIDAY replaces it by implementing the same interface (e.g. HTTP client to a FRIDAY service) — the UI and server actions depend only on the interface.

## Briefing

`consult()` returns: score, confidence and their plain-language interpretation, evidence count, latest Red Team verdict, main risk, unassessed criteria, and one recommended next action (deterministic rules: no Red Team → run it; STOP → hold/exit; LOW confidence → gather evidence; else the next experiment).

## Command Center (`/friday`)

Sections: Current Context (selected opportunity) · Conversation · Related Opportunity · Pending Decisions · Research Status · Advisor Council · Actions · Decision Memory.

Commands are routed deterministically (`src/domain/executive/friday-intent.ts`) to application services:

| Say | Does |
|---|---|
| 「〜を調べて」 | new ResearchRun (pipeline runs after the response) |
| 「競合調査」「海外比較」「支払意思」「市場規模」「規制」「追加調査」 | additional research linked to the context opportunity |
| 「Red Team」 / 「顧問会議」 / 「どう思う？」 | red team · advisor council · briefing |
| 「承認 理由: …」「保留」「却下」「ウォッチ」 | human decision (next gate for 承認), source = FRIDAY |
| 「実験」 / 「PoC仕様書」 / 「Claude Codeにエクスポート」 | experiment draft · PoC spec · CLAUDE_CODE_BUILD_PROMPT (only after PoC approval) |
| 「今日のブリーフ」 | daily brief summary |

The free-text reason never changes the intent (the command head is classified on its own).

## Memory

The conversation lives only in the browser. Persisted: decisions (`subject`, `decision`, `rationale` = reason, `decided_by`, `opportunity_id`, `created_at`, `source = FRIDAY`) and the artefacts FRIDAY produced (advisor sessions, reports). Every FRIDAY command is audited by intent (not text).

## CEO approval flow

DISCOVERED → (RESEARCHING) → VALIDATED → EXPERIMENT_PROPOSED → **EXPERIMENT_APPROVED** (human) → POC_PROPOSED → **POC_APPROVED** (admin/owner = CEO) → **LAUNCHED** (CEO); ON_HOLD / REJECTED (human) at any step. Enforced in the domain, the application (`opportunity.ceo_approve`) and the database trigger.

## Advisor Council

Eight analytic perspectives — Long-term/Vision, Customer Value, First Principles, Execution, Focus/UX, Capital Efficiency, People, Mission/Social Value — inspired by widely published decision principles. They are lenses, not impersonations: no names, no invented quotes (the only quotes are customer evidence). Each returns a stance, opinion, concerns, questions, assumptions and required evidence; FRIDAY integrates Consensus / Disagreement / Unanswered Questions / Critical Assumptions / Required Evidence into `advisor_sessions`. The human decides.

## PoC Spec → Claude Code

`PoC仕様書` generates Problem, Customer, Evidence, Hypothesis, Value Proposition, Core Features, Non Goals, User Flow, Data Model, API, AI, Metrics, Experiment, Kill Criteria, Technical Architecture, Security, Cost Limit and Acceptance Criteria (DRAFT until approved; EXPERIMENT_APPROVED → POC_PROPOSED). After the CEO approves the PoC, `Claude Code Export` produces `CLAUDE_CODE_BUILD_PROMPT.md` for a new repository (downloadable).
