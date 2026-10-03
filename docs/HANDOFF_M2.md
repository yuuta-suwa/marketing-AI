# HANDOFF — Milestone 2 (Research Engine)

## Completed

- `/research/new`: main prompt 「何を調べたいですか？」 + collapsible **Manual Import** (text / URL / CSV) and **Advanced** (Country, Language, Date Range, Sources, Maximum Items, Budget, Deep Research). Advanced choices override parsed values (also when an LLM parses the directive).
- Directive parser through the `AIProvider` port with Zod validation; rule-based fallback.
- Connector interface complete: every connector implements `search`, `healthCheck`, `complianceStatus`, `estimateCost`.
- Manual Import: text, URL (SSRF-safe, robots.txt, no redirects), CSV (RFC 4180, aliases).
- Web Search as a `SearchProvider` adapter (Brave implementation); e-Stat official adapter; X / Google Places / Tripadvisor adapters with env contract, health check, settings, mocks and tests.
- Compliance gate with `APPROVED / RESTRICTED / PENDING_REVIEW / DISABLED_PENDING_COMPLIANCE / DISABLED` and terms notes; admins can disable connectors or make them stricter (never looser) in Settings → Connectors.
- Source normalization (canonical URL, content hash, language detection, country inference flagged) and deduplication.
- Evidence engine (verbatim excerpts, back-reference to source item — DB enforced).
- Signal extraction with all required fields plus per-field provenance (`signals.field_provenance`: problem = FACT, scores = INFERENCE, …).
- Research Run UI: objective, status, progress bar, connectors (status, count, duration, retries, cost), items collected, evidence, signals, agents running, estimated cost, errors, sources (MOCK badge).
- Partial success: e.g. X FAILED / Web SUCCESS / e-Stat SUCCESS → `PARTIAL_SUCCESS` with results.
- Observability: structured JSON logs; `connector_runs.cost_usd`; Settings → Logs page for connector and agent runs.
- Mock connector mode for demo/E2E.

## Files changed

`src/connectors/{search/*,mock.ts,url-import.ts,manual-import.ts,web-search.ts,registry.ts,estat.ts,tripadvisor.ts}`, `src/application/research/{csv-import.ts,collect.ts,pipeline.ts}`, `src/application/settings/connectors.ts`, `src/application/queries.ts`, `src/domain/{research/*,signal/signal.ts,source/normalize.ts,connector/connector.ts}`, `src/infrastructure/{supabase/*,memory/*,server-context.ts}`, `src/app/actions/{research.ts,settings.ts}`, `src/app/(app)/research/**`, `src/app/(app)/settings/{connectors,observability}`, `src/components/forms/{research-form,connector-setting-form}.tsx`, tests, docs.

## Database changes

`20261003000600_m2_research_engine.sql`: `signals.field_provenance jsonb`, `connector_runs.cost_usd`, index on `connector_runs (organization_id, started_at)`.

## Tests

| Suite | Result |
|---|---|
| Unit + integration | 92 passed (CSV, URL safety/robots, locale, overrides, mock pipeline, partial success, source preferences, connector settings, URL import warnings) |
| DB | all assertions passed |
| E2E | 5 passed (incl. 「日本の旅行市場で不満を調べる」 → signals visible; connector settings) |
| lint / typecheck / build | clean |

## Known limitations

- Live connector calls need credentials (see below); verified with mocked HTTP only.
- URL import extracts text with a lightweight HTML stripper (no readability scoring).
- Signal extraction without an LLM is lexical (cue words); quality improves with `ANTHROPIC_API_KEY`.

## Environment variables

New: `CONNECTOR_MOCK_MODE`, `CONNECTOR_MOCK_FAIL` (demo only). Connector credentials unchanged (see `.env.example`).

## Next milestone

M3 Opportunity Engine: semantic embeddings, LLM cluster naming, scoring settings UI, competitor analysis, market size (3 methods), business models, CFO, additional-research update loop, experiments.
