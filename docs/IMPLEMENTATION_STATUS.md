# Implementation Status

Last updated: 2026-10-03 · Milestone 1 complete.

## Repository audit (start of M1)

The repository was empty (no commits, no files). Everything below was built from scratch on Next.js 16.3, React 19.2, TypeScript 5.9 (strict), Tailwind 4, Supabase (`@supabase/ssr`, `@supabase/supabase-js`), Zod 4, Vitest 5, Playwright 1.63. Dependencies are pinned exactly; `package-lock.json` is committed.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Audit, architecture, Supabase schema, RLS, auth, domain models | ✅ done |
| 2 | Directive, run state machine, connector interface, manual, web search, e-Stat, evidence | ✅ done (web search / e-Stat adapters need credentials to run live) |
| 3 | Signal extraction, embeddings, clustering, opportunity, scoring | ✅ MVP (deterministic + Anthropic LLM path; local embeddings) |
| 4 | Competition, market size, business model, CFO, Red Team | 🟡 Red Team done; others M2 |
| 5 | Mobile dashboard, opportunity detail, research UI | ✅ MVP |
| 6 | FRIDAY adapter, advisor council, decision gate | 🟡 FRIDAY local adapter + decision gates done; council M3 |
| 7 | Watchlist, daily brief, automation, cost control | 🟡 cost control (budgets, ledger, UI) done; rest M3 |
| 8 | PoC spec, Claude Code export, feedback loop | ⬜ M4 |
| 9 | Testing, security audit, performance, release | 🟡 test suites in place for all built features |

## MVP acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Usable on smartphone | ✅ | mobile-first UI, E2E on Pixel 7 viewport |
| Works as PWA | ✅ | manifest, icons, service worker with offline fallback |
| Login | ✅ | Supabase email/password + callback; demo mode for local |
| Japanese research instruction | ✅ | rule + AI directive parser |
| ResearchRun creation | ✅ | |
| ≥2 working connectors | 🟡 | Manual Import runs; Web Search + e-Stat (+X) adapters are implemented and tested with mocked HTTP — need `BRAVE_SEARCH_API_KEY`(+confirmation) / `ESTAT_APP_ID` to run live |
| SourceItem normalization | ✅ | |
| Deduplication | ✅ | external id / hash / canonical url / semantic hook |
| Evidence storage | ✅ | verbatim, DB-enforced |
| Signal extraction | ✅ | |
| Signal clusters | ✅ | |
| ≥3 opportunities | ✅ | integration + E2E |
| Score display | ✅ | with per-criterion breakdown |
| Confidence display | ✅ | separate axis with breakdown and caps |
| Evidence reference | ✅ | quotes + source links on detail page |
| Red Team | ✅ | 12 questions, verdict |
| Additional research | ✅ | 8 types, linked runs |
| FRIDAY interface | ✅ | local adapter + consult UI |
| Cost display | ✅ | dashboard + settings/costs |
| RLS correct | ✅ | 42 DB assertions |
| Unauthorized access prevented | ✅ | RLS + server session checks + 404 |
| Automated tests pass | ✅ | 73 unit/integration, 42 DB, 3 E2E |
| Production build | ✅ | `npm run build` |

## Known limitations

- Pipeline runs in-process via `after()`; long runs depend on platform max duration (queue worker in M3).
- Local hash embeddings are lexical, so clustering groups by shared wording; sentence-level evidence can yield many small clusters. Hosted semantic embeddings are planned (M2).
- Cluster naming is rule-based; LLM naming planned.
- Competitor / market size / business model / CFO analyses not yet implemented (tables exist; UI shows "M2").
- Connector settings and scoring weights are read-only in the UI (editable via SQL by admins).
- No per-user rate limiter for server actions yet (budget bounds expensive work).
- OpenAI / Gemini adapters not implemented (port ready).
- X deletion-sync not implemented (connector is PENDING_REVIEW by default).
