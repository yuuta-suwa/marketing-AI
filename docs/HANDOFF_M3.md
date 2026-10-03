# HANDOFF — Milestone 3 (Opportunity Engine)

## Completed

- **Embeddings**: semantic signal text (type, persona, situation, problem, desired outcome, alternative); `EmbeddingProvider` port with `openai` (1536-dim, batched, cost-tracked) and `local-hash` fallback (budget stop or provider failure); vectors in pgvector.
- **Clustering**: centroid similarity + category rule + LLM naming (`ClusterNamerAgent`, budgeted, multi-signal clusters only).
- **Cluster metrics**: signal count, source count, countries, first/last seen, momentum, average pain, average pay signal, evidence confidence.
- **Opportunity generation**: from evidence-backed clusters only; all required fields with per-field provenance.
- **Score**: 14 criteria / 100 points; weights editable by admins in Settings → Scoring (sum 100 enforced in UI, app and DB); market size and monetization quality now fed by calculations.
- **Confidence**: separate from score; quality, diversity, freshness, volume, agreement, contradiction penalty, hard caps.
- **Competitors** (`CompetitorAnalystAgent`): evidence-cited competitors and alternatives; LLM path requires the name to appear in cited evidence; manual entries are ASSUMPTION unless they cite evidence.
- **Market size** (`QuantAnalystAgent`): Top Down / Bottom Up / Value Theory; formula, inputs, assumptions, evidence ids and confidence stored; AI never supplies the numbers.
- **Business models** (`BusinessModelAgent`): all 11 types compared with fit score, rationale, risks; one primary model.
- **CFO** (`CFOAgent`): price, gross margin, CAC, LTV, LTV/CAC, payback, break-even customers, monthly/annual revenue and profit scenarios, variable/AI/API costs — each FACT / ASSUMPTION / CALCULATION, with warnings.
- **Red Team**: 12 questions incl. why customers won't buy, losing to competitors, imitation, distribution, CAC, AI necessity, biggest assumption, worst case, exit criteria.
- **Opportunity UI**: cards (title, score, confidence, customer, pain, momentum, pay signal, revenue model, main risk); detail with buttons 追加調査 / 海外比較 / 競合調査 / 支払意思調査 / 市場規模 / Red Team / Watch / FRIDAY / PoC, plus sections for competitors, market size, business model/CFO, experiments.
- **Additional research loop**: Opportunity → ResearchRun (linked) → new Evidence → related evidence linked (semantic similarity or run focus) → competitor refresh for COMPETITOR runs → re-score + confidence → audit `opportunity.updated_from_research`. Additional runs no longer spawn duplicate opportunities.
- **Experiments** (feedback loop foundation): Hypothesis, Test, Metric, Target, Cost, Deadline, Result, Decision; PROPOSED → APPROVED (human, attributed) → RUNNING → COMPLETED (result required) — enforced in domain and DB.

## Database changes

`20261003000700_m3_opportunity_engine.sql` (see DATABASE.md).

## Tests

| Suite | Result |
|---|---|
| Unit + integration | 105 passed |
| DB (RLS + triggers) | 53 assertions passed |
| E2E (mobile) | 7 passed (incl. analyses + scoring editor) |
| lint / typecheck / build | clean |

## Known limitations

- Market size/CFO quality depends on the inputs supplied; defaults are visible ASSUMPTIONs.
- Business-model comparison is rule-based (no LLM path yet).
- Opportunity merging across runs (same opportunity found twice) is not automated.

## Environment variables

New: `EMBEDDING_PROVIDER`, `OPENAI_EMBEDDING_MODEL` (and `OPENAI_API_KEY` for embeddings).

## Next milestone

M4 FRIDAY / Executive OS: command center, decision memory, advisor council, CEO approval flow, PoC spec, Claude Code export, daily brief, watchlist monitoring, notifications, feedback loop.
