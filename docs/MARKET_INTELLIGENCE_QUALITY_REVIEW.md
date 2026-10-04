# Market Intelligence Quality Review

## Status: **PENDING — no live Golden Run yet**

This review can only be completed against a real Golden Run (`docs/GOLDEN_RESEARCH_RUN.md`, currently BLOCKED_ON_LIVE_INFRASTRUCTURE). Judging market intelligence on MOCK or stubbed data would be meaningless, so **no verdict is recorded here.**

What follows:
- the evaluation protocol;
- an honest pre-assessment of the system's *design* against each question, from code and from harness runs on synthetic data. This is about capabilities and known weaknesses, not market findings.

## Protocol (per Golden Run)

1. Two reviewers independently read the generated report and the run page. At least one must know the travel market.
2. Each reviewer fills the in-app Quality review (rating 1–5, decision, signal usefulness). The KPIs VALID_SIGNAL_RATE, DEEP_DIVE_RATE and COST_PER_VALID_OPPORTUNITY come only from these entries.
3. Each reviewer answers the questions below with **Yes / Partly / No** and cites evidence ids or source URLs.
4. Disagreements are discussed and the consensus is recorded. Calibration does not change system scores; it informs later phases.

| # | Question | Reviewer A | Reviewer B | Consensus | Evidence cited |
| --- | --- | --- | --- | --- | --- |
| 1 | Did the system identify **non-obvious** problems? | | | | |
| 2 | Or did it merely summarise **obvious complaints**? | | | | |
| 3 | Did it distinguish **complaints from willingness to pay**? | | | | |
| 4 | Did it identify **existing alternatives**? | | | | |
| 5 | Did it identify **why alternatives fail**? | | | | |
| 6 | Did it avoid turning **every complaint into a startup idea**? | | | | |
| 7 | Did it identify **market distribution constraints**? | | | | |
| 8 | Did **Red Team materially challenge** the ideas? | | | | |
| 9 | Did the **evidence actually support** the conclusions? | | | | |

## Pre-assessment of the design (not a result)

| # | What the system does by design | Known weakness to watch in the live run |
| --- | --- | --- |
| 1 | Clusters signals semantically when `EMBEDDING_PROVIDER=openai`, otherwise lexically (local hash). The LLM PainMiner extracts persona, situation and problem. | Lexical clustering groups by shared words. Expect "obvious" clusters unless OpenAI embeddings and the LLM are enabled. |
| 2 | Momentum, cross-source support and pay signals rank clusters. | **Every cluster with evidence becomes an opportunity, up to 5.** There is no minimum-support threshold. See 6. |
| 3 | Signals carry `signalType` (PAY_SIGNAL, PRICE_GAP …) and a separate `willingnessToPayScore`. The opportunity `paySignal` field is labelled FACT only when quoted. | Snippet-only web evidence rarely contains explicit payment intent. Expect low pay-signal coverage, and confirm it is not inflated. |
| 4 | `currentAlternatives` comes from WORKAROUND signals. Competitor analysis only names competitors that appear in collected evidence. | No external competitor search: alternatives are limited to what complainants mention. |
| 5 | `alternativeFailure` and `marketGap` fields exist. The heuristic marketGap is a generic templated sentence (INFERENCE). | Without the LLM, "why alternatives fail" is template text. Check the LLM output cites evidence. |
| 6 | Red Team verdicts (STOP / NEEDS_EVIDENCE …), the Confidence caps and the human gates stop weak ideas from advancing. | Generation itself does not filter. EVIDENCE_BACKED_OPPORTUNITY_RATE (≥ 3 evidence from ≥ 2 independent sources) measures how many are weak. In harness runs, heuristic titles were awkward (e.g. 「毎回迷・案内 — 乗換需要の受け皿」). |
| 7 | `distributionStrategy` field; the business-model comparison; the DISTRIBUTION additional-research type. | The heuristic leaves distribution mostly unaddressed. It is a likely gap unless the LLM fills it from evidence. |
| 8 | Twelve Red Team questions with severity and epistemic tags; the verdict is derived from severities. | In MOCK harness runs every heuristic verdict was NEEDS_EVIDENCE: cautious, but generic. Judge whether the LLM objections are specific. |
| 9 | Hard guarantees: evidence is verbatim (DB trigger), ids are never invented, and the chain is traced to source URLs (`checkEvidenceChain`). | Traceability ≠ support. A verbatim quote can still be over-interpreted. Reviewers must read the cited quotes. |

## Decision rule for this review

- **Pass:**
  - questions 3, 6, 8 and 9 are "Yes" or "Partly" with cited evidence;
  - no opportunity relies on uncited claims;
  - VALID_SIGNAL_RATE and EVIDENCE_BACKED_OPPORTUNITY_RATE are recorded as baselines.
- **Fail:** any opportunity presents an unsupported claim as fact, or the evidence chain is broken.
  - Product-quality findings feed the next phase. They are not fixed by tuning against this single run.
