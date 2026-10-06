# Compliance Explainer

Internal eToro repo for **copy suitability** and **Negative Market** checkers: research, Excel source-of-truth workbooks, production config snapshots, and a read-only explainer app.

**New Cursor agent:** start at [AGENTS.md](AGENTS.md), then [app-handoff/HANDOFF.md](app-handoff/HANDOFF.md).

| | |
|---|---|
| Suitability workbook | [eToro-suitability-test-calculator.xlsx](eToro-suitability-test-calculator.xlsx) — `build_workbook.py` / `verify_workbook.py` |
| NM workbook | [eToro-negative-market-calculator.xlsx](eToro-negative-market-calculator.xlsx) — `build_nm_workbook.py` / `verify_nm_workbook.py` |
| NM formulas | [nm-formulas.md](nm-formulas.md) |
| Explainer app | [explainer/](explainer/README.md) — suitability + NM tabs; AT placeholder |
| Live configs | [config-prod/](config-prod/) |
| Product research sources | [research-sources/](research-sources/README.md) — ST / NM / AT spreadsheets + AT scoring doc |
| App build brief | [app-handoff/HANDOFF.md](app-handoff/HANDOFF.md) |

Private. Owner: [alexandergol-tr](https://github.com/alexandergol-tr). Extracted from `etoro-assets/rev-eng/suitability-test`.

---

# Suitability Test (Copy Trading) — reverse-engineering

How eToro decides whether a user may copy another trader or a Smart Portfolio, and at what risk level. Produced with the `reverse-engineer-feature` skill. **Discovery only — no code changes.**

---

## Headline finding

**There are two Suitability Tests in this repository, and only one of them is live.**

| | **Legacy ST** (pre-2022) | **Suitability 2022** (current) |
|---|---|---|
| Where the maths runs | **In the browser**, `kyc/` AngularJS app | **On the server**, KycAnalyzer + Cosmos config |
| Outcome | Binary — copy blocked or not | Graded — a max copyable risk score |
| Inputs | 4 sub-tests over ~8 KYC answers | 8 weighted components + a hard-block rule + a daily solvency check |
| Status | Dead code path, still shipped; runs only when the A/B flag is off | Live since **June 2022** |
| Switch | `NewSuitability2022 === 'true'` → legacy is skipped entirely (`risk-info.ts:113-116`) |

The legacy formula is fully readable in this repo, down to literal question and answer IDs. The live formula is **not in this repo at all** — it lives in the KYCAnalyzer service, and everything quantitative here comes from two sources: the calculators in that service, and the `ClientRiskProfileConfiguration` documents **read directly from the production Cosmos account** and mirrored under [config-prod/](config-prod/). Both formulas are documented here.

Production holds 104 configuration documents across 14 regulations, but **only five run a suitability test**: CySEC (v24), FCA (v15), ASIC GAML (v15), FSRA (v10) and ASIC (v9). Offshore, FINRA and the US entities ship a configuration with no suitability factors at all and gate copy trading by other means. MAS is the one regulation that ran the test and had it removed — v1 and v2 carry the full factor tree, v3 onward do not.

The single most consequential change between the two formulas: the old one could only **block or allow**. The new one assigns a risk profile and caps the risk score a user may copy, so low-risk users get a restricted Discover page instead of a blanket ban.

**The model has been tested against production and it holds.** Every structural rule reproduces the engine exactly on **231,537 scored users** — all five regulations, zero exceptions — and a full recomputation from raw answers matches the engine's stored result for **99.96%** of a 45,590-user CySEC cohort. Alternative readings of the ambiguous rules were scored in the same pass and falsified rather than merely being argued against. [prod-validation.md](prod-validation.md) has the method, the numbers and the limits.

**One defect to know about before using any of this.** The copy funnel and the scoring configuration are maintained in different repos and are allowed to drift. On question 8, purpose of trading, the funnel offers eight answers under every regulation; CySEC scores seven and the other four score four. An answer the config does not list is scored as `Medium` with no error, so "Investments" — which CySEC deliberately treats as its most conservative answer, worth an authorised score of 3 — is worth 6 under FCA and FSRA. The same thing happens on question 15: "Investments/Deposits" has been picked by 28,850 users and is scored by no regulation at all. Both were found by inspection; nothing checks that every offered answer is scored. [tech.md §6.3](tech.md) has the cross-tab.

---

## The live formula in one box

```
Component  1  Experience frequency   = MAX(Equities, Crypto, LeveragedCfd)
Component  2  Experience volume      = MAX(the three "invested amount" answers)
Component  3  Trading knowledge
Component  4  Trading strategy (holding duration)
Component  5  Purpose of trading
Component  6  Risk appetite
Component  7  Source of income
Component  8  Complex-products knowledge assessment

Component  9  MiCA crypto knowledge          CySEC only, from version 20

Factor A = MIN(C5, C6)
Factor B = AVG(C1, C2, C3, C4, C7, C8 [, C9])  rounded DOWN
ClientRiskLevel = MIN(Factor A, Factor B)       default when unanswered: Medium

Minimal|Low -> AuthorizedRiskScore 3
Medium      -> 6
MediumHigh  -> 8
High        -> 10

May copy any person or portfolio whose risk score <= AuthorizedRiskScore.
```

Levels are ordinal: `Minimal=0, Low=1, Medium=2, MediumHigh=3, High=4`. Per-answer level tables are in [tech.md](tech.md) §4.

---

## Documents

| File | Contents |
|---|---|
| [product.md](product.md) | What the user experiences: the four copy statuses, journeys with flow diagrams, the eight questions in plain language, screens and copy, functional requirements, success criteria, analytics. |
| [tech.md](tech.md) | The formulas. Complete per-answer scoring tables for the live test, the full legacy client-side algorithm with question/answer IDs, API contracts, state, error semantics, and the config surface. |
| [bff.md](bff.md) | A BFF contract proposal collapsing the current 6-to-9 call copy-intent sequence into two endpoints. |
| [verification.md](verification.md) | Evidence and confidence per claim, seven verification questions, gaps, and readiness. |
| [eToro-suitability-test-calculator.xlsx](eToro-suitability-test-calculator.xlsx) | Working spreadsheet, **one calculator tab per regulation** — `CySEC v24`, `FCA v15`, `ASIC v9`, `ASIC GAML v15`, `FSRA v10`. Answer the yellow cells on the tab that matches the user and get a risk profile, an authorised risk score and a verdict for a given target. Each tab shows only what its config actually uses: component 9 appears on the CySEC tab alone, question 8's unscored answers are called out per regulation, and the hard block is broken out into one visible row per condition with a `Met?` column. `Monitoring` models the daily solvency gate; `Scoring` holds every answer-to-level mapping. |
| [prod-validation.md](prod-validation.md) | The production validation: what was tested against 231,537 scored users, what matched, the two defects it surfaced, and what it could not reach. Also the data-lake tables and the Cosmos projection for anyone repeating it. |
| [config-prod/](config-prod/) | `ClientRiskProfileConfiguration` documents, verbatim from production Cosmos with only the Cosmos metadata fields stripped. `CySEC-24`, `FCA-15`, `ASICGAML-15`, `FSRA-10` and `ASIC-9` are the five live scoring configs and the ground truth for every number in `tech.md`. `13-1`, `MAS-2` and `MAS-12` are the MAS trail: v1 under a stale id, v2 still scoring, v12 current and no longer scoring. |
| [explainer/](explainer/README.md) | **Working skeleton of the Suitability Explainer app** — Next.js + TypeScript, runs on synthetic examples with no credentials. Renders a user's outcome, the stored calculation tree, and a reconstruction of the ongoing-monitoring limit from that user's own answers. Keeps apart the states that are easy to conflate: not-assessed versus `Minimal`, an internal account's bypassed result, a regulation that no longer scores, a tree that arrived flattened, and a monitoring gate that never ran versus one that passed. `npm install && npm run dev`. Spike only — no auth, no audit log, no real-data path. |
| [app-handoff/](app-handoff/HANDOFF.md) | **Build brief for the internal Suitability Explainer app** — a read-only tool that takes a GCID or CID and renders that user's outcome plus the calculation path behind it. Written to be handed to another team or agent with no access to this investigation: mission, the decisions already taken, five guardrails covering destructive endpoints and PII, four gates to close before writing code, a phased build order and ten testable acceptance criteria. `DATA-CONTRACT.md` has every data source with exact shapes, id maps and the SQL that rebuilds the tree; `MANIFEST.md` lists what must travel with the pack and how to verify on arrival that it did. |

Regenerate the workbook with `python build_workbook.py` after changing any scoring table, then `python verify_workbook.py` to recalculate the real Excel formulas and assert 47 scenarios across all five tabs — including the ten component-8 vectors lifted from the service's own unit tests, the six-rung production score ladder, the per-condition hard-block rows, and the question-8 fallback in both directions. Pass a tab name (`python verify_workbook.py "FCA v15"`) to run just that regulation. Both need `openpyxl`; the verifier also needs `formulas`.

**Reading order:** this page → [tech.md](tech.md) §3–§5 if you want the maths → [product.md](product.md) §2 if you want the user-facing behaviour → [verification.md](verification.md) §2 before you quote any number externally.

---

## Three things worth knowing before you read further

**1. The hard block is much rarer than people assume — and it is not the same everywhere.** `SuitabilityBlock` requires **all four** of low risk appetite, a preservation-oriented trading purpose, income under 200K and liquid assets under 200K to be true simultaneously. Contrast the Negative Market CFD knockout, which fires on **any** of two conditions. When someone says "suitability blocked me", they usually mean the risk-score cap (L2) or the daily solvency check (L3), not this. ASIC GAML is the one real exception to the shared rule: it widens the risk-appetite trigger to the two lowest bands, narrows the purpose trigger, and adds a fifth condition on income source, so a modest-income pensioner is blocked there and not under CySEC. FCA looks like a second exception — it sets `DefaultResult: Blocked` where the others set `NotBlocked` — but that field is never read on the suitability code path, so FCA blocks exactly like CySEC. See [tech.md §3.2.1](tech.md).

**2. Component 8 scores what you *didn't* tick.** Reading the config alone, the knowledge assessment looks broken: `+2` on two answers and `−2` on four caps the total at `+4`, yet `High` needs `>= 6`. The service resolves it — `GetScoreByAnswerIds` subtracts the weight of every answer the user left unticked, so leaving a false statement alone earns `+2` and nothing scores zero. The single exception is ticking nothing at all, which skips the group and defaults Component 8 to `Medium`.

One wrinkle: the config scores six statements but the question catalogue only asks **five**. The retired sixth can never be ticked, so it hands every user a constant `+2` — which makes the reachable range `−8 … +12`, not `−12 … +12`, and means `High` needs 4 of 5 rather than 5 of 6. Production bears this out: across ~101,700 users and 31 distinct answer patterns, nobody has ever ticked it, and the observed score ladder is exactly `−8, −4, 0, +4, +8, +12`. It changes no band outcome, because every threshold is spaced 4 apart and the offset is 2. See [tech.md §4.3.1](tech.md).

**3. "Suitability test" is three different tests at eToro.** Copy suitability (this document), **US Options** suitability (US-only, binary, gates options trading), and the **ASIC** suitability test (Australia-only, gates CFDs, has a 3-attempts-per-month limit). They share a name and nothing else. [product.md](product.md) §8 has the disambiguation table.

---

## Scope

**In scope** — the copy-trading suitability test: questions, scoring, thresholds, outcomes, enforcement points, and both the legacy and current implementations.

**Out of scope for this research note** — the Appropriateness Test (warn vs block; not modelled in the workbooks). Negative Market is in-repo: see [nm-formulas.md](nm-formulas.md) and the NM calculator. Options and ASIC tests beyond disambiguation remain out of this pack.

**Screenshots** — none were supplied, so there is no `images/` directory. Screen copy is transcribed verbatim into [product.md](product.md) §5 from the production locale file instead.

---

## Source inventory

**Origin repository** (`eToro/etoro-assets` at extraction; paths below are in that monorepo)

- `kyc/src/app/suitability-test*.ts` — the complete legacy algorithm
- `kyc/src/api/models/` — `risk-info`, `appropriateness`, `copy-block`, `basic-user`, `experiment`
- `kyc/src/app/modals/portfolio-management/` — the six suitability screens
- `etoro/libs/compliance/src/lib/trading/bl/` — the modern `ComplianceSuitabilityService` gate
- `etoro/apps/etoro/src/app/discovery-module/bl/` — Discover personalisation
- `kyc/src/app/__mocks__/kyc-aggregated.mock.ts` — 64-question snapshot of the question bank

**Production configuration** — the `ClientRiskProfileConfiguration` container of the `prod-kycanalyzer` Cosmos account, read on 2026-08-09. This is the highest-authority source: it is what the engine loads at runtime. Live `CySEC-24` proved byte-identical to the service's unit-test asset, which retrospectively validates the previous pass. Access was a temporary Entra data-plane role scoped to that one container and revoked immediately after the read; **the container holding client answers was never queried**.

**Production outcomes and answers** — the data lake, read on 2026-08-10: `main.compliance.bronze_kycanalyzer_clientriskprofile` (a frozen 2025-01-15 → 2025-01-23 mirror of the Cosmos `ClientRiskProfile` container, 344,675 documents of which 231,537 are scored) joined to `main.compliance.bronze_userapidb_kyc_customeranswers` (live raw answers, 22.4M users). No Cosmos data-plane access to client data was needed. Aggregates only; no user identifiers left the query layer.

**KYCAnalyzer service** — `ClientRiskProfile/Suitability/Calculators/` (`WeightQuestionAnswerCalculator`, `SuitabilityRiskLevelCalculator`, `FinancialSustainabilityCalculator`), `ClientRiskProfile/Pipeline/Calculators/SuitabilityCalculator.cs`, `ClientRiskProfile/Extensions/RiskLevelExtensions.cs`, `UnitTests/Assets/ClientRiskProfileConfiguration_*.json`, `UnitTests/DomainTests/ClientRiskProfile/WeightQuestionAnswerCalculatorTests.cs`. The Confluence pages below are corroborating and in two places were wrong.

**Confluence** — `KYC Analyzer Formulas from Cosmos`, `HLD COAKV-3587 Suitability Calculation.`, `CopyTrading new suitability test`, `Copy Rules`, `HLD: COAKVB-4860 Restrictions for Copy`, `Experience and Objectives questionnaire`, `Copy Block - Ongoing Monitoring`, `Client Risk Profile Configuration - current versions`, `Suitability data reports`, `CopyTrader procedures`, `Regulations Rules`.

**Prior art** — `rev-eng/fsra-cascaded-kyc/` covers the same formula family from the FSRA angle and reaches consistent conclusions; where this document is more precise, it is because the Cosmos config was recovered here and inferred there.

---

## Evidence convention

Claims carry a source tag at the point of use: `[prod-config]` for the live Cosmos documents, `[prod-data]` for the production outcomes and answers in the data lake, `[code]` with `file:line`, `[confluence]` with page name, or `[inferred]`. Anything tagged `[inferred]` has not been confirmed against a primary source. [verification.md](verification.md) tracks confidence per claim and lists the questions that remain open.
