# Research sources (product / compliance)

Handed to the repo on **2026-08-25** so agents can cross-check explainer logic against product specs for **Suitability (ST)**, **Negative Market (NM)**, and **Appropriateness (AT)**.

## Authority

| Rank | Source | Use for |
|---|---|---|
| 1 | [`config-prod/`](../config-prod/) | Live engine input — wins when anything disagrees |
| 2 | Stored `ClientRiskProfile` (Cosmos) | What actually happened for a user |
| 3 | Files in this folder | Product intent, timelines, proposed AT scoring, onboarding flows |

**Do not** silently prefer a spreadsheet over Cosmos config. If they disagree, say so in notes / workbook comments / UI warnings.

AT is **not modelled** in the explainer yet. These files are the starting pack for that work; they do not authorize inventing an AT engine in app code.

## Files

| File | Covers | What is in it |
|---|---|---|
| [at-st-nm.xlsx](at-st-nm.xlsx) | ST, NM, AT, crypto, monitoring | Per-regulation NM variants (NM A–I, Typeform, pensions, ERS), current flows matrix, suitability vs product risk, AT A/B scoring drafts, UK crypto, FSA basic/advanced, timelines |
| [advanced-instruments-configuration.xlsx](advanced-instruments-configuration.xlsx) | Instrument onboarding | How NM + AT + ST gate CFD/crypto/copy funnels per CySEC/FCA: cooling-off, eligibility, user vs instrument assessment, cascaded screens |
| [at-test-and-knowledge-assessment-new-scoring.docx](at-test-and-knowledge-assessment-new-scoring.docx) | AT scoring proposals | “AT Test Scoring” — frequency/volume/knowledge components with current vs suggested Version I / II scores |

## Map to explainer tabs

| Tab | Primary sources here | Status in app |
|---|---|---|
| Suitability | `at-st-nm.xlsx` → Current Suitability, Ongoing Monitoring, Suitability NM (copy hard-block); also copy flow in Advanced Instruments | Live |
| Negative Market | `at-st-nm.xlsx` → Current NM, NM A–I, Typeform, Crypto NM, ERS; Advanced Instruments eligibility / UA formulas | Live (stored results + config) |
| Appropriateness | Docx scoring + `AT A` / `AT B` sheets + Advanced Instruments “Instrument Assessment (AT)” | Placeholder tab only |

## Known tripwires (from a first skim)

- Product sheets often say **NM** where the config key is `*NegativeMarket`, and **AT** / Instrument Assessment where the stored profile may use `ProductAppropriateness`.
- CySEC “Suitability NM” (appetite + purpose + income/assets &lt; 200K) is the **copy suitability hard block**, not CFD NM KnockOut — same confusion already called out in [`nm-formulas.md`](../nm-formulas.md).
- Auto-release days/trades in Advanced Instruments (CySEC 60/20, FCA 30/5) should match config `AutoReleaseCondition`; verify before trusting the sheet.
- AT scoring in the docx is **suggested** (Version I / II), not proven live. Confirm against Cosmos / KYCAnalyzer before building AT replay.

## Next useful pass

1. Diff `Current NM` / NM A–I against [`nm-formulas.md`](../nm-formulas.md) and `config-prod/*`.
2. Extract AT component list + score tables from the docx into a short `at-formulas.md` draft (still “product proposed”, not engine).
3. Map Advanced Instruments eligibility formulas to stored `ProductAppropriateness` / `ProductNegativeMarkets` once a live profile dump exists for AT.
