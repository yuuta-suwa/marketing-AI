# HANDOFF — Milestone 1

## Completed

- Repository audit (empty repo) and full project scaffold (Next.js 16 App Router, strict TS, Tailwind 4, PWA).
- Supabase schema: 29 required tables + `signal_evidence`, `connector_runs`, `red_team_reviews`; composite tenant FKs; pgvector (HNSW); retention column.
- RLS on every table, role model (viewer/member/admin/owner), security-definer entry points, signup bootstrap, append-only logs.
- DB-enforced integrity: verbatim evidence, run state machine, opportunity decision gates with human approval, scoring-weight validation, evidence-id arrays, last-owner protection.
- Domain layer: directive (Zod) + rule parser, run state machine, normalization, dedup, evidence integrity, signal schema, clustering, momentum, score (14 criteria, DB-configurable weights), confidence (independent, capped), budget, compliance gate, authorization, epistemic status.
- Application layer: createResearch, runResearchPipeline (COLLECTING→…→COMPLETED/PARTIAL_SUCCESS), AgentRunner (call caps, budget, logs, cost), Red Team, decisions, additional research (8 types), FRIDAY local adapter, read models.
- Agents: MarketDirector, PainMiner, ClusterNamer, JTBDAnalyst, RedTeam — LLM path (Anthropic) with Zod validation and evidence-id checks, plus deterministic fallbacks.
- Connectors: Manual Import, Web Search (Brave), e-Stat, X, Google Places, Tripadvisor + 11 compliance-gated scaffolds.
- Mobile UI: dashboard, research input, runs, run detail (live polling), opportunities, opportunity detail (evidence, score breakdown, red team, additional research, FRIDAY, decisions), FRIDAY, signals, clusters, settings (connectors, costs, scoring, security), placeholders for watchlists/reports.
- Audit log: research.created / research.started / connector.executed / agent.executed / opportunity.decided / friday.* / research.completed.
- Authentication guard (`src/lib/auth-guard.ts`) shared by proxy and app shell, unit-tested.
- Docs set and CI workflow.

## Files changed

All files are new. Key paths: `supabase/migrations/*`, `supabase/tests/*`, `scripts/test-db.sh`, `src/domain/**`, `src/application/**`, `src/agents/**`, `src/connectors/**`, `src/infrastructure/**`, `src/app/**`, `src/components/**`, `tests/**`, `docs/**`, `.github/workflows/ci.yml`, `.env.example`.

## Architecture decisions

See [ARCHITECTURE.md](ARCHITECTURE.md#key-decisions). Highlights: composite tenant FKs; RLS as the single authorization source; verbatim evidence enforced in SQL; deterministic agent fallbacks so the system works (and tests run) without paid APIs; `after()` execution for the first slice; explicit demo mode for E2E.

## Database changes

Five migrations (foundation, core schema, integrity, security, compliance vocabulary `APPROVED/RESTRICTED/PENDING_REVIEW/DISABLED_PENDING_COMPLIANCE/DISABLED` + connector terms notes). Apply in filename order.

## Tests

| Suite | Result |
|---|---|
| `npm test` (unit + integration, incl. authentication guard and audit events) | 77 passed |
| `npm run test:db` (PostgreSQL 16 + pgvector) | 42 assertions passed |
| `npm run test:e2e` (Pixel 7, production build) | 3 passed |
| `npm run lint`, `npm run typecheck`, `npm run build` | clean |

## Known limitations

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md#known-limitations).

## Required credentials

| Purpose | Variables |
|---|---|
| Production auth/data | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| LLM agents | `ANTHROPIC_API_KEY` |
| Second/third live connectors | `BRAVE_SEARCH_API_KEY` + `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true`; `ESTAT_APP_ID` |
| Optional | `X_BEARER_TOKEN` + `X_TERMS_CONFIRMED=true` |

## Environment variables

See `.env.example` (all documented, secrets server-only).

## Next actions (Milestone 2)

1. Provision Supabase + credentials; run the post-deploy checks; add `supabase start` based auth E2E to CI.
2. Hosted semantic embeddings adapter (1536-dim) + LLM cluster naming.
3. CompetitorAnalyst, QuantAnalyst (Top-down / Bottom-up / Value Theory with cited inputs), BusinessModelAgent, CFOAgent; fill `competitors`, `market_estimates`, `business_models`.
4. OpenAI / Gemini provider adapters.
5. Connector and scoring settings editing UI (admin), `compliance_checks` workflow.
6. Per-user rate limiting for server actions.
