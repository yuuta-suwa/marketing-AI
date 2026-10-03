# Compliance

## Rules

- Official APIs first. Licensed feeds or user uploads otherwise.
- Prohibited everywhere: ToS-violating scraping, CAPTCHA bypass, authentication bypass, rate-limit/access-control circumvention. robots.txt is necessary but not sufficient — terms of service and API terms are reviewed too.
- A connector whose permission cannot be confirmed is `PENDING_REVIEW` or `DISABLED_PENDING_COMPLIANCE` and **cannot run** (enforced by `evaluateConnectorGate`, tested).
- The retired Yahoo!知恵袋 API is not assumed; marketplaces without confirmed API/permission are not auto-collected.
- No conclusions about a whole market from a single SNS: confidence is capped at MEDIUM for a single channel.

## Status meanings

| Status | Meaning | Can run |
|---|---|---|
| APPROVED | access method and storage rights confirmed | yes (if enabled + credentials) |
| PENDING_REVIEW | official access exists, terms/plan need confirmation or legal review | no |
| DISABLED_PENDING_COMPLIANCE | no confirmed permitted access method yet | no |
| BLOCKED | explicitly forbidden by an org | no |

Changing a code-level status from PENDING_REVIEW to APPROVED is a reviewed code change (or, for `web_search` / `x`, an operator env confirmation documenting that the subscription terms were reviewed). Org admins can record reviews in `compliance_checks` (who, when, terms URL, notes).

## Data handling

- Raw third-party text: `source_items.retention_until` supports expiry; evidence keeps only short verbatim excerpts with source URL.
- Attribution metadata is stored where required (e-Stat, Google, Tripadvisor).
- X posts: deletion compliance job is planned (M3).
- Personal data: the system analyses needs, not individuals; no profiling of authors; author handles are not stored by current adapters.
- Manual uploads: the uploader confirms they have rights to the material (UI copy).
