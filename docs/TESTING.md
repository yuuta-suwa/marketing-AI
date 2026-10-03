# Testing

| Layer | Command | What |
|---|---|---|
| Unit | `npm test` | CSV + URL import safety (SSRF, robots.txt), locale enrichment, score, confidence, state machines (incl. SQL parity), dedup/normalization, evidence integrity, signal validation, budget, compliance gate, authorization, directive parsing, clustering, JSON extraction |
| Integration | `npm test` | full vertical slice on in-memory repositories; connector failure → PARTIAL_SUCCESS; invented evidence ids rejected; budget stop; cost ledger; tenant isolation; viewer restrictions; connectors with mocked HTTP; compliance defaults |
| Database | `npm run test:db` | spins up a throwaway PostgreSQL + pgvector, applies a Supabase shim (`auth.users`, `auth.uid()`, roles) + all migrations, runs 42 RLS/integrity assertions |
| E2E | `npm run test:e2e` | production build in demo mode, Pixel 7 viewport: login → research input → run → ≥3 opportunities → evidence → Red Team → FRIDAY → decision → additional research; PWA manifest + security headers; 404 for unknown ids |

## Requirements

- Database tests: PostgreSQL 15+ binaries and pgvector (`apt-get install postgresql-16 postgresql-16-pgvector`). `PG_BIN` overrides the binary path.
- E2E: Playwright Chromium (`npx playwright install chromium`). `PLAYWRIGHT_CHROMIUM_PATH` can point to a preinstalled binary. Run `npm run build` first.

## Fixtures

`tests/fixtures/travel-voices.ts` and the E2E manual input are **synthetic test texts**, clearly marked, and never loaded by the application at runtime.

## Not yet covered

- Supabase Auth flows against a live Supabase instance (sign-up email, session refresh) — covered manually per DEPLOYMENT.md post-deploy checks; automated in M2 with `supabase start` in CI.
- Live calls to external APIs (intentionally mocked).
