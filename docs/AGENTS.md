# AI Employees (Agents)

Agents are **bounded, single-purpose steps** called by explicit workflows — never a free-running loop.
Every call goes through `AgentRunner` (`src/application/agent-runner.ts`):

1. per-agent call cap per unit of work (`maxCallsPerAgent`, default 12; Red Team: 1)
2. budget check **before** the call (`SKIPPED_BUDGET` if it would exceed run/daily/monthly limits)
3. `agent_runs` row (input, output, provider, model, tokens, cost, duration, status, error)
4. `cost_ledger` row for paid calls
5. errors are logged + persisted and returned (no silent failure); callers fall back to deterministic logic

| Agent | Status | Role | LLM path | Deterministic path |
|---|---|---|---|---|
| MarketDirectorAgent | ACTIVE | NL → ResearchDirective | Zod-validated JSON; user limits re-applied | `parseDirectiveByRules` |
| PainMinerAgent | ACTIVE | Evidence → MarketSignals | must cite given evidence ids; others dropped | lexical cue detection (JA/EN), problem = verbatim quote |
| ClusterNamerAgent | ACTIVE | cluster label + summary | (M2) | top shared terms + dominant type |
| JTBDAnalystAgent | ACTIVE | cluster → Opportunity draft | must cite given ids; no invented numbers/competitors | template with per-field epistemic labels; market size = 「未推定」 |
| RedTeamAgent | ACTIVE | 12 questions to kill the idea | ids validated; FACT without evidence downgraded | derived from evidence counts/signal types; gaps called out as gaps |
| Japan/Global/Commerce/Travel/Ticket/PublicSystem Scout | PLANNED (M2–M3) | source planning per domain | | |
| CompetitorAnalyst, QuantAnalyst, BusinessModel, CFO | PLANNED (M2) | competition, market size, models, unit economics | | |
| ComplianceAgent, ReporterAgent | PLANNED (M3) | | | |

Registry: `src/agents/registry.ts`.

## Providers

`AIProvider` port (`src/domain/agent/ai-provider.ts`): `generate({system, prompt, schema})` must return schema-validated output or throw.

| Provider | Status | Notes |
|---|---|---|
| Anthropic (`@anthropic-ai/sdk`) | implemented | default model `claude-opus-5-5`, `output_config.effort` (default medium, `ANTHROPIC_EFFORT`), server-side refusal fallback (`fallbacks: "default"`), JSON validated with Zod |
| none | implemented | deterministic agents only (zero cost) |
| OpenAI / Gemini | planned | same port; selected with `AI_PROVIDER` |

`EmbeddingProvider`: `local-hash` (feature hashing, 1536 dims, zero cost) is the default and the budget fallback. Hosted embedding adapters are planned (M2) — the column is `vector(1536)` so they drop in.

## Prompt rules shared by all LLM agents

- cite only evidence ids from the provided list
- never invent market sizes, prices, competitor names, statistics or regulations — say "unknown" and what to verify
- label epistemic status honestly
