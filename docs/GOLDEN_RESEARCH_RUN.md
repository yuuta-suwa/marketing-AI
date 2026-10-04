# Golden Research Run

## Status: **NOT EXECUTED — BLOCKED_ON_LIVE_INFRASTRUCTURE**

No live Golden Run has been performed. Nothing below is a live result, and no number here may be read as one.

**Blocked on (verified 2026-10-04):**
- No hosted Supabase project, deployed frontend or deployed worker.
- No credentials in this environment: `BRAVE_SEARCH_API_KEY`, `ESTAT_APP_ID`, `ANTHROPIC_API_KEY`, Supabase keys.
- The environment's egress policy denies `api.search.brave.com`, `api.e-stat.go.jp` and `api.supabase.com`.

`npm run golden-run` was executed here. It stopped at preflight with `BLOCKED_ON_LIVE_INFRASTRUCTURE` and listed exactly the items above. It does not fall back to mock data.

## Research question

> 日本の旅行市場で、旅行者が感じている不満・不便・不足・既存サービスへの要望から、新しい事業機会を調査してください。特に、現在の解決方法では十分に満たされていない課題と、利用者がお金を払ってでも解決したい可能性がある課題を優先してください。

## How the Golden Run is produced (once the checklist in `docs/LIVE_VALIDATION.md` is done)

```bash
# with the worker deployed:
APP_ENV=staging GOLDEN_RUN_USER_ID=<uuid> npm run golden-run
# or before the worker is deployed (queue processed in-process, still real Supabase + real APIs):
APP_ENV=staging GOLDEN_RUN_USER_ID=<uuid> npm run golden-run -- --inline-worker
```

**What the script does:**
1. Live preflight:
   - Supabase reachable;
   - Brave and e-Stat each make one minimal request;
   - Anthropic passes `count_tokens` and one ≤ 60-token structured-output request (Zod-validated, prompt-boundary separated, cost recorded).
2. Creates the directive and run as `GOLDEN_RUN_USER_ID`, enqueues it, and lets the worker run the four stages.
3. Runs Business Model → CFO → Red Team on up to 5 opportunities, after which the worker re-scores them. Then builds the FRIDAY context.
4. Computes evidence quality, the KPIs, the cost baseline and the human-review table from persisted data.
5. Writes `docs/golden-runs/<date>-<runId>.md` and `.json`.

**Outcome:**
- The run fails validation if **any** source item is synthetic (MOCK) or the evidence chain is broken.
- Copy the generated report over this file to record the run.

## Record (to be filled from the generated report)

| Field | Value |
| --- | --- |
| Date | — |
| Run ID | — |
| Duration | — |
| Real connectors used | — |
| SourceItems / deduplicated | — / — |
| Evidence / Signals / Clusters / Opportunities | — / — / — / — |
| Total API calls / LLM calls | — / — |
| Estimated cost (Brave / e-Stat / Anthropic / embedding) | — |
| Errors / retries / partial failures | — |
| Final status | — |
| Release decision | not taken (no run) |

Evidence quality and KPI baselines: see the generated report. The human fields (Human Rating, Human Decision, signal usefulness) are entered in the app under run page › Quality review; the system never fills them.

## What has been verified (not live)

The **harness** is tested end to end in `tests/integration/golden-run.test.ts`, with Brave and e-Stat HTTP stubbed at the fetch layer:
- every stage passes;
- MOCK sources force `LIVE_VALIDATION_FAILED`;
- unavailable sources fail visibly;
- KPIs come only from human reviews;
- worker health is published.

This proves the machinery, **not** the market data.
