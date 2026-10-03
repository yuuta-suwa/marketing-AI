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
  openAdvisorCouncil(opportunityId)       // M3
  runRedTeam(opportunityId)
  approveOpportunity(opportunityId, toStatus, rationale?)
  rejectOpportunity(opportunityId, rationale?)
  holdOpportunity(opportunityId, rationale?)
  watchOpportunity(opportunityId, rationale?)
  createExperiment(opportunityId)         // M4
  generatePoCSpec(opportunityId)          // M4
}
```

The spec's parameterless signatures were given explicit inputs (opportunity id, rationale, target status) so calls are auditable.

`LocalFridayAdapter` implements it in-process against the application services. An external FRIDAY replaces it by implementing the same interface (e.g. HTTP client to a FRIDAY service) — the UI and server actions depend only on the interface.

## Briefing

`consult()` returns: score, confidence and their plain-language interpretation, evidence count, latest Red Team verdict, main risk, unassessed criteria, and one recommended next action (deterministic rules: no Red Team → run it; STOP → hold/exit; LOW confidence → gather evidence; else the next experiment).

## Advisor Council (M3)

Implemented as analytic perspectives (Long-term Vision, Customer Value, First Principles, Execution, Focus/UX, Capital Efficiency, People, Mission/Social Value) inspired by public decision principles — not impersonation of individuals. FRIDAY will merge them into Consensus / Disagreement / Unanswered Questions / Critical Assumptions / Required Evidence, stored in `advisor_sessions`.
