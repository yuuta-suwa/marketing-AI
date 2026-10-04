# Testing

| Layer | Command | What |
|---|---|---|
| Unit | `npm test` | CSV + URL import safety (SSRF, robots.txt), locale enrichment, score, confidence, state machines (incl. SQL parity), dedup/normalization, evidence integrity, signal validation, budget, compliance gate, authorization, directive parsing, clustering, JSON extraction |
| Integration | `npm test` | full vertical slice on in-memory repositories; connector failure → PARTIAL_SUCCESS; invented evidence ids rejected; budget stop; cost ledger; tenant isolation; viewer restrictions; connectors with mocked HTTP; compliance defaults |
| Database | `npm run test:db` | spins up a throwaway PostgreSQL + pgvector, applies a Supabase shim (`auth.users`, `auth.uid()`, roles) + all migrations, runs 115 RLS/integrity/queue assertions (`supabase/tests/[1-9]*.sql`) |
| Queue / worker | `npm test` (`tests/integration/queue-worker.test.ts`) | enqueue-only POST, chained stages, progress persistence, idempotent enqueue, **duplicate delivery**, **worker restart mid-job** (lease expiry + resume, no duplicates vs. clean baseline), retry with backoff, max attempts → dead letter (+ run FAILED), non-retryable errors, cancellation (queued + processing), graceful shutdown, tenancy/IDOR, owner lost access, scheduled jobs |
| Production hardening | `npm test` (`tests/integration/production-hardening.test.ts`, `tests/unit/phase5-production.test.ts`) | **connector timeout**, **one connector failing while others succeed**, 429 retry / 401 no-retry, cost logging, all `MAX_*` hard limits, prompt injection (stored as data, section separation, invented ids rejected), evidence-chain integrity (incl. cross-org + invented ids), connector readiness (READY_NEEDS_CREDENTIALS / LIVE_READY / FAILED classes / PENDING_COMPLIANCE / MOCK), real-scenario harness, env contract (production rejects mock/demo), job state machine SQL parity |
| Database queue | `npm run test:db` (`supabase/tests/20_job_queue.sql`) | RLS on jobs, enqueue RPC idempotency/BOLA, service-role-only worker RPCs, SKIP LOCKED leasing, heartbeat ownership, lease-expiry re-claim, backoff, dead letter, crashed final attempt fails run, cancel, admin re-queue, evidence/opportunity uniqueness, atomic signal + evidence RPC |
| Live readiness | `npm run smoke:live [-- --workflow]` | needs real credentials; one minimal request per connector, then the real research scenario |
| E2E (viewports) | `npm run test:e2e` | iPhone 14 / Pixel 7 / desktop: every main route renders with an h1 and no horizontal overflow |
| E2E | `npm run test:e2e` | production build in demo mode, Pixel 7 viewport: login → research input → run → ≥3 opportunities → evidence → Red Team → FRIDAY → decision → additional research; PWA manifest + security headers; 404 for unknown ids |

## Requirements

- Database tests: PostgreSQL 15+ binaries and pgvector (`apt-get install postgresql-16 postgresql-16-pgvector`). `PG_BIN` overrides the binary path.
- E2E: Playwright Chromium (`npx playwright install chromium`). `PLAYWRIGHT_CHROMIUM_PATH` can point to a preinstalled binary. Run `npm run build` first.

## Fixtures

`tests/fixtures/travel-voices.ts` and the E2E manual input are **synthetic test texts**, clearly marked, and never loaded by the application at runtime.

## Not yet covered

- Supabase Auth flows against a live Supabase instance (sign-up email, session refresh) — covered manually per DEPLOYMENT.md post-deploy checks; automated in M2 with `supabase start` in CI.
- Live calls to external APIs: automated tests never call them; `npm run smoke:live` does, once credentials exist (not run in this environment — no credentials).
- Supabase Realtime delivery against a hosted project (polling fallback is covered by E2E).
