# MARKET RADAR OS — Release v0.1.0 (MVP)

Released 2026-10-04 · branch `claude/market-radar-os-uyp7mf` · tag `v0.1.0`

## Features

**Research engine**
- Natural-language research command on mobile with Advanced options (country, language, date range, sources, max items, budget, deep research).
- Directive parsing via the `AIProvider` port (Zod-validated) with a deterministic fallback.
- Connectors: Manual Import (text / URL / CSV), Web Search (provider adapter, Brave), e-Stat, X, Google Places, Tripadvisor + 11 compliance-gated scaffolds; mock mode for demo/E2E.
- Compliance gate (`APPROVED / RESTRICTED / PENDING_REVIEW / DISABLED_PENDING_COMPLIANCE / DISABLED`), org overrides can only be stricter.
- Normalization (canonical URL, content hash, locale enrichment), deduplication, verbatim evidence (DB-enforced), signal extraction with per-field provenance.
- Partial success when a connector fails; structured logs; observability page.

**Opportunity engine**
- Embeddings (local hash or OpenAI 1536-dim) → clustering with LLM-assisted naming → evidence-backed opportunities.
- 14-criteria score (admin-editable weights) kept separate from evidence confidence (quality, diversity, freshness, volume, agreement, contradictions + hard caps).
- Competitors (evidence-cited), market size (Top-down / Bottom-up / Value theory with formula, inputs, assumptions), 11 business models, CFO unit economics (FACT / ASSUMPTION / CALCULATION), Red Team (12 questions).
- Additional research (8 types) feeding new evidence back into the originating opportunity and re-scoring it.
- Experiments with human-approved state machine.

**FRIDAY / Executive OS**
- Command center (context, conversation routing, pending decisions, research status, advisor council, actions, decision memory).
- Advisor Council (8 analytic perspectives, integrated consensus/disagreement/questions/assumptions/evidence).
- Decision gates with CEO approval for PoC and launch.
- PoC specification (18 sections) and gated Claude Code build prompt export.
- Daily market brief, watchlists with scheduled monitoring, meaningful-change notifications.
- Feedback loop (customer response → revenue/churn) and lineage CSV (Signal → Opportunity → Experiment → Revenue).

## Architecture

Next.js 16 App Router (mobile-first PWA) → server actions → application use cases → pure domain; infrastructure behind ports (Supabase repositories with user-scoped client + RLS, in-memory repositories for tests/demo, Anthropic SDK, embedding providers, connectors). See [ARCHITECTURE.md](ARCHITECTURE.md).

## Setup

```bash
npm ci
cp .env.example .env.local          # fill values
supabase db push                    # applies supabase/migrations/*.sql (9 files)
npm run build && npm start
```
Local evaluation without Supabase: `MRO_DEMO_MODE=true CONNECTOR_MOCK_MODE=true npm run dev`. Details: [DEPLOYMENT.md](DEPLOYMENT.md).

## Required credentials

| Purpose | Variables | Required |
|---|---|---|
| Auth + data | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes |
| Scheduled jobs | `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | for monitoring / daily brief |
| LLM agents | `ANTHROPIC_API_KEY` (`ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`) | optional (deterministic fallback) |
| Semantic embeddings | `EMBEDDING_PROVIDER=openai`, `OPENAI_API_KEY` | optional |
| Web search | `BRAVE_SEARCH_API_KEY` + `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true` | optional |
| Official statistics | `ESTAT_APP_ID` | optional |
| X | `X_BEARER_TOKEN` + `X_TERMS_CONFIRMED=true` | optional |

## Security

- RLS on every table; tenant isolation verified by DB tests (users, orgs, viewers, anon); composite tenant FKs.
- Roles from `organization_members` only (never `user_metadata`); CEO-level approvals for PoC/launch enforced in DB.
- Secrets server-side only (`server-only` modules); no secret in the client bundle (verified); service role only in CRON_SECRET-protected system jobs with explicit org scoping.
- Zod validation on every action/AI output; quoted PostgREST filters; CSV formula-injection neutralized; SSRF-safe URL import honoring robots.txt.
- Per-user rate limits (DB-backed, atomic) on research, FRIDAY, analyses, report generation, URL import.
- Audit log for research, connectors, agents, decisions, FRIDAY actions, configuration changes.
- Security headers (frame-ancestors none, nosniff, HSTS, referrer, permissions), no `X-Powered-By`; `npm audit` clean.

## Costs

- Every paid call is checked against per-run / daily / monthly budgets before running and recorded in `cost_ledger`; optional AI work stops on budget exhaustion while collected data is kept and the reason is shown.
- Default model `claude-opus-5-5` ($4 / $20 per MTok) at `medium` effort; embeddings `text-embedding-3-small` ($0.02 / MTok); Brave ≈ $0.005/query; e-Stat free.
- Without API keys the system runs entirely on deterministic agents and local embeddings at zero AI cost.

## Quality gates (this release)

| Check | Result |
|---|---|
| Unit + integration (Vitest) | 134 passed |
| Database (PostgreSQL 16 + pgvector, RLS/triggers/RPCs) | all assertions passed |
| E2E (Playwright: Android full scenarios; iPhone / Android / desktop layout smoke) | 55 passed |
| Lint / strict typecheck / production build | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |

## Known limitations

- Live connector calls are verified with mocked HTTP only until credentials are provided; Google Places / Tripadvisor remain `PENDING_REVIEW` pending legal review of storage terms.
- Research runs execute via `after()` within the platform's request duration; a queue worker is the next step for long runs.
- Without an LLM key, signal extraction is lexical and opportunity text is template-based (always labelled with its epistemic status).
- FRIDAY intent routing and the advisor council are rule-based (no LLM debate yet); notifications are in-app only.
- Supabase Auth flows are verified manually per DEPLOYMENT.md (DB policies are tested automatically).
- Watchlist competitor snapshots query competitors per opportunity (fine at MVP scale).

## Future roadmap

1. Queue-based research workers (Supabase Queues / pg_cron) and streaming progress.
2. OpenAI / Gemini LLM adapters; LLM-based intent routing and council debate with evidence citations.
3. More licensed connectors (Reddit Data API, YouTube, app reviews for own apps, government RSS/APIs) after compliance review; X deletion sync.
4. Push/email notifications; team invitations and organization switching UI.
5. Learning loop: model which signal patterns convert to revenue using the lineage dataset.
