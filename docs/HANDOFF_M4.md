# HANDOFF — Milestone 4 (FRIDAY / Executive OS)

## Completed

- **FRIDAY Command Center** (`/friday`): Conversation, Current Context, Related Opportunity, Pending Decisions, Research Status, Advisor Council, Actions, Decision Memory. Not a chat UI: commands route to the research engine, analyses and decision gates.
- **ExecutiveAssistantAdapter**: `sendDirective`, `requestDeepResearch`, `consult`, `openAdvisorCouncil`, `runRedTeam`, `approve/reject/hold/watchOpportunity`, `createExperiment`, `generatePoCSpec`, `exportClaudeCode` — `LocalFridayAdapter` in-process; an external FRIDAY implements the same interface.
- **FRIDAY memory**: conversation stays in the browser; only decisions persist (subject, decision, reason, decidedBy, relatedOpportunity, timestamp, source=FRIDAY). Commands audited by intent.
- **Advisor Council**: 8 perspectives as analytic lenses (no impersonation, no invented quotes) → Consensus, Disagreement, Unanswered Questions, Critical Assumptions, Required Evidence; stored in `advisor_sessions`.
- **CEO approval flow**: PoC approval and launch require an admin/owner decision (domain + app + DB trigger); experiments and rejections require a human decision.
- **PoC Spec Generator**: all 18 sections from the opportunity dossier; DRAFT until approved; moves EXPERIMENT_APPROVED → POC_PROPOSED.
- **Claude Code Export**: `CLAUDE_CODE_BUILD_PROMPT.md` (download) only after POC_APPROVED.
- **Daily Market Brief**: new signals, high-signal pains, fast-rising clusters, pay/switching signals, price/regulatory changes, top opportunities, watchlist changes, pending CEO decisions; shown on the dashboard, persisted once per day, notification only if meaningful.
- **Watchlist**: Opportunity / Competitor / Problem / Market / Country / Keyword (+Industry, Persona, Technology, Regulation); scheduled monitoring via `/api/cron/monitor` and "今すぐチェック".
- **Notification logic**: score jump ≥10, confidence change, new competitor, regulation signals, price signal surge, market-signal surge; first check is a silent baseline; deduplicated per watchlist/kind/day.
- **Feedback loop**: customer response/interview, conversion, revenue, retention, churn, feedback, launch result (`feedback_events`), `opportunity_lineage` view and CSV export (Signal → Opportunity → Experiment → Revenue).

## Database changes

`20261003000800_m4_executive_os.sql` (see DATABASE.md).

## Tests

| Suite | Result |
|---|---|
| Unit + integration | 133 passed |
| DB | all assertions passed (incl. CEO gate, watchlist tenancy, notification/feedback attribution, lineage RLS) |
| E2E (mobile) | 10 passed (incl. FRIDAY approvals → PoC → export, watchlist/brief/feedback, cron auth) |
| lint / typecheck / build | clean |

## Known limitations

- FRIDAY intent routing is deterministic (keyword based); LLM intent classification can be added behind the same function.
- Advisor council perspectives are rule-based analyses of the dossier (no LLM debate yet).
- Notifications are in-app only (no push/email channel yet).

## Environment variables

New: `CRON_SECRET`; `SUPABASE_SERVICE_ROLE_KEY` is now used by cron jobs only.

## Next

Final QA / release v0.1.0.
