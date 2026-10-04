# FRIDAY — Current Capabilities

> **In short: FRIDAY today is a deterministic command router and briefing layer.**
>
> - It does not hold LLM conversations.
> - It does not reason autonomously.
> - It never makes decisions on its own.
>
> The architecture (`ExecutiveAssistantAdapter`) allows an LLM-backed FRIDAY later. That is not implemented, and nothing in the product should describe today's FRIDAY as autonomous AI.

## What FRIDAY can do now

| Capability | How it works | Rule-based / LLM |
| --- | --- | --- |
| Understand a command (JA/EN) | `parseFridayIntent()` (`src/domain/executive/friday-intent.ts`): ordered regular expressions on the command head. A free-text reason (`理由: …` / `because …`) is extracted separately and cannot change the intent. Unrecognised input of 12 characters or more is treated as a research request. | **Rule-based** |
| Start research (「〜を調べて」) | Creates the directive and run, then **enqueues** a `RESEARCH_COLLECTION` job. Replies at once with a progress link. | Routing is rule-based. The directive parse uses the LLM if configured. |
| Additional research (競合 / 海外 / 支払意思 / 市場規模 / 規制 / 追加調査) | `startAdditionalResearch()` creates a linked run and enqueues it. The worker incorporates related evidence into the opportunity and re-scores it. | Rule-based routing; pipeline agents may use the LLM |
| Red Team | `runRedTeam()`: `RedTeamAgent` | **LLM** when configured, with a deterministic fallback |
| Consult (「どう思う？」) | `LocalFridayAdapter.consult()`: headline, score/confidence interpretation, evidence count, Red Team verdict, unknowns (unscored criteria), and the next action from a fixed decision list (no Red Team → run it; STOP → withdraw/hold; LOW confidence → more evidence; else the next experiment). | **Rule-based** |
| Advisor Council | `runAdvisorCouncil()`: eight analytic lenses (Vision, Customer Value, First Principles, Execution, Focus/UX, Capital Efficiency, People, Social Value). Each lens scores the dossier with fixed rules. They are lenses, not personas: no names, no quotes. | **Rule-based** |
| Approve / Hold / Reject / Watch | `decideOpportunity()` with `source = FRIDAY` and a recorded rationale. DB triggers still enforce the human-decision gates and the CEO (admin/owner) gate for `POC_APPROVED` and `LAUNCHED`. | Rule-based; **a human always decides** |
| Experiment draft | Creates a PROPOSED experiment (14-day deadline, interview method). It needs human approval to run. | Rule-based template |
| PoC spec / Claude Code export | `generatePocSpecReport()` / `exportClaudeCodePrompt()`: templates filled from the opportunity, evidence and analyses. They are marked DRAFT until the PoC is approved. | **Rule-based** templates |
| Daily brief | `computeDailyBrief()`: counts and lists from the last 24 h (signals, high-pain, pay signals, pending decisions). | **Rule-based** |
| Context | The FRIDAY page lets the user choose the "Current Context" opportunity. Commands that need one ask for it. | — |

### Privacy and audit

- Conversation text is **not stored**.
- Every command is audited as `friday.command` with the intent only.
- Decisions are stored with their rationale and `source = FRIDAY`.

## What already uses an LLM (when `ANTHROPIC_API_KEY` is set)

These are pipeline agents that FRIDAY *triggers*. FRIDAY itself never calls the model.

- MarketDirectorAgent (directive parsing)
- PainMinerAgent (signals)
- ClusterNamerAgent
- JTBDAnalystAgent (opportunity drafts)
- RedTeamAgent
- CompetitorAnalystAgent

Every call:
- goes through `AgentRunner` (budget check, per-agent and per-run call caps, `agent_runs` + `cost_ledger`);
- uses the prompt-injection boundary (`src/domain/agent/prompt-boundary.ts`);
- has its output validated (Zod schema, and cited evidence ids must exist).

Each agent has a deterministic fallback, so FRIDAY behaves the same without a key, just with simpler wording.

## Not implemented (future work)

- Free-form conversational FRIDAY: LLM intent classification, multi-turn dialogue, follow-up questions.
- LLM-written briefings or consult narratives. Today they are fixed templates over stored data.
- An LLM advisor council. Today the eight lenses are rule-based.
- Voice input/output, push or email delivery (notifications are in-app only), and a calendar or meeting integration.
- An external FRIDAY service over HTTP. The `ExecutiveAssistantAdapter` interface exists; only `LocalFridayAdapter` implements it.
- Autonomous action. Out of scope by design: FRIDAY proposes and routes, humans decide.

## Verification

- Intent routing: `tests/unit/m4-executive.test.ts`.
- FRIDAY flows: `tests/integration/executive-os.test.ts`. The research command now only enqueues; it is asserted to create exactly one `QUEUED` job.
- E2E: `tests/e2e/executive-os.spec.ts`.
