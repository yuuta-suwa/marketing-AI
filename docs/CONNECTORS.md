# Connectors

Port: `MarketConnector` (`src/domain/connector/connector.ts`)

```ts
interface MarketConnector {
  id; name; category; description; env; sourceQuality; enabledByDefault; credentialsRequired
  search(directive, context): Promise<RawSourceItem[]>
  healthCheck(): Promise<ConnectorHealth>
  complianceStatus(): ComplianceProfile
  credentialsPresent(): boolean
  estimateCost?(directive): Promise<CostEstimate>
}
```

Connectors return `RawSourceItem` (validated with Zod by the pipeline); normalization (`canonical_url`, `content_hash`, cleaning) and dedup happen in the domain, so business logic never sees provider-specific shapes.

Runtime behaviour (`src/application/research/collect.ts`): parallel execution, compliance gate, budget check, timeout (20 s), one bounded retry for retryable errors (429/5xx/network), a `connector_runs` record per connector. One connector failing marks the run degraded → `PARTIAL_SUCCESS`, never a silent drop.

| id | Source | Access | Default compliance | Credentials | Notes |
|---|---|---|---|---|---|
| `manual_import` | user-provided text | upload | APPROVED | none | interview notes, surveys, exports the user is entitled to use |
| `web_search` | SearchProvider (Brave) | official API | PENDING_REVIEW → APPROVED with `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true` | `BRAVE_SEARCH_API_KEY` | snippets only, no crawling of result pages |
| `estat` | e-Stat 政府統計 | official API | APPROVED | `ESTAT_APP_ID` | statistics table metadata as STATISTIC evidence; attribution stored |
| `x` | X API v2 recent search | official API | PENDING_REVIEW → APPROVED with `X_TERMS_CONFIRMED=true` | `X_BEARER_TOKEN` | must honor deletions (M3: deletion sync) |
| `google_places` | Places API (New) | official API | PENDING_REVIEW (fixed) | `GOOGLE_PLACES_API_KEY` | storage/caching terms need legal review |
| `tripadvisor` | Content API | official API | PENDING_REVIEW (fixed) | `TRIPADVISOR_API_KEY` | licence is for display; analytics storage needs permission |
| `instagram`, `reddit`, `youtube`, `commerce`, `marketplace`, `ticket`, `travel`, `government`, `app_review`, `job_market`, `yahoo_chiebukuro` | — | scaffold | DISABLED_PENDING_COMPLIANCE | — | visible in settings, `search()` always throws |

## Manual Import: text, URL, CSV

- **Text**: blank-line separated items, optional `source: <name>` first line.
- **URL** (≤20): single user-supplied pages, fetched server-side with SSRF protection (http/https only, no credentials in URL, private/loopback/link-local/metadata addresses rejected after DNS resolution), robots.txt honored, no redirects followed, 2 MB / 15 s limits, HTML → text. Failures are reported as connector warnings (`PARTIAL`), never silently dropped.
- **CSV** (≤1 MB, ≤200 rows): header row required; `body`/`text`/`本文` column mandatory; optional `title`, `url`, `source`, `published_at`, `country`, `language` (aliases supported). Skipped rows are counted.

## Web search provider adapter

`WebSearchConnector` depends only on `SearchProvider` (`src/connectors/search/search-provider.ts`). `BraveSearchProvider` is the first implementation; adding another backend (Tavily, Bing, Google Programmable Search…) means implementing the interface and swapping it in `registry.ts`.

## Mock mode (demo / E2E only)

`MRO_DEMO_MODE=true` + `CONNECTOR_MOCK_MODE=true` runs the **real adapters** against canned HTTP responses (`src/connectors/mock.ts`), so parsing, normalization, dedup and the compliance gate are exercised. Every item is labelled `[MOCK]` with `metadata.synthetic = true` and shown with a MOCK badge. `CONNECTOR_MOCK_FAIL=x` simulates a provider outage (→ PARTIAL_SUCCESS). Mock mode is impossible with Supabase configured.

## Normalization

`normalizeSourceItem` → canonical URL, cleaned body, sha256 `content_hash`; `enrichLocale` fills a missing language (script detection) and a missing country when the directive targets exactly one country — both flagged in metadata (`languageDetected`, `countryInferred`).

Organization overrides (`connectors` table: `enabled`, `compliance_status`) can only make a connector **stricter**.

## Adding a connector

1. Implement `MarketConnector` in `src/connectors/<id>.ts` using `fetchJson` (timeout + retry classification).
2. Declare `env`, `complianceStatus()` (status, access method, terms URL, prohibitions).
3. Register it in `src/connectors/registry.ts`.
4. Add a mocked-HTTP test in `tests/integration/connectors.test.ts`.
5. Document it here and in `.env.example`; review per [COMPLIANCE.md](COMPLIANCE.md).
