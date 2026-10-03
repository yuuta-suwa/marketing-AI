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
| `web_search` | Brave Search API | official API | PENDING_REVIEW → APPROVED with `WEB_SEARCH_STORAGE_RIGHTS_CONFIRMED=true` | `BRAVE_SEARCH_API_KEY` | snippets only, no crawling of result pages |
| `estat` | e-Stat 政府統計 | official API | APPROVED | `ESTAT_APP_ID` | statistics table metadata as STATISTIC evidence; attribution stored |
| `x` | X API v2 recent search | official API | PENDING_REVIEW → APPROVED with `X_TERMS_CONFIRMED=true` | `X_BEARER_TOKEN` | must honor deletions (M3: deletion sync) |
| `google_places` | Places API (New) | official API | PENDING_REVIEW (fixed) | `GOOGLE_PLACES_API_KEY` | storage/caching terms need legal review |
| `tripadvisor` | Content API | official API | PENDING_REVIEW (fixed) | `TRIPADVISOR_API_KEY` | licence is for display; analytics storage needs permission |
| `instagram`, `reddit`, `youtube`, `commerce`, `marketplace`, `ticket`, `travel`, `government`, `app_review`, `job_market`, `yahoo_chiebukuro` | — | scaffold | DISABLED_PENDING_COMPLIANCE | — | visible in settings, `search()` always throws |

Organization overrides (`connectors` table: `enabled`, `compliance_status`) can only make a connector **stricter**.

## Adding a connector

1. Implement `MarketConnector` in `src/connectors/<id>.ts` using `fetchJson` (timeout + retry classification).
2. Declare `env`, `complianceStatus()` (status, access method, terms URL, prohibitions).
3. Register it in `src/connectors/registry.ts`.
4. Add a mocked-HTTP test in `tests/integration/connectors.test.ts`.
5. Document it here and in `.env.example`; review per [COMPLIANCE.md](COMPLIANCE.md).
