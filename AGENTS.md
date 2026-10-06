# Compliance Explainer — agent pickup

Internal eToro tools for **copy suitability** and **Negative Market (NM)**. Private repo. Not customer-facing.

If you are a new Cursor agent with no prior conversation: read this file, then [app-handoff/HANDOFF.md](app-handoff/HANDOFF.md) before writing code. Do not start from the Next.js app alone.

## What this repo is

Three related artefacts, not one:

| Artefact | Role | Status |
|---|---|---|
| Excel calculators | Human source-of-truth models of live config | Suitability + NM both working |
| Research docs | Reverse-engineering of KYCAnalyzer / configs | Written; see [README.md](README.md) |
| `explainer/` | Read-only Next.js app (GCID/CID → outcome + tree) | Suitability spike; **NM not in the app yet** |

They share KYC answers and `config-prod/`. They are **separate tests**. Passing one does not pass another. Appropriateness is a third test and is **not modelled**.

## Do not

- Reimplement KYCAnalyzer scoring in the app. The engine persists its own tree; the app **reads**. Spreadsheets exist so a human can check the engine.
- Call `POST`/`PATCH` on KYCAnalyzer profile or configuration routes. Both have destructive verbs on the same path as GET. Clients here are read-only by construction.
- Guess GCID vs CID vs demo CID from a number. Require `IdKind`. The spaces overlap (~99% of GCIDs are also someone else's CID).
- Treat a missing product key as `NotBlocked`. Missing = not gated by that NM document.
- Commit `.env`, Cosmos keys, Databricks tokens, or live customer documents.
- Put UK crypto overlay on non-FCA tabs. It is FCA (country 218) only.
- Treat MAS `CkaTradingKnowledge` / `CarTradingKnowledge` as typed-in knowledge. They are **derived** from the three listed criteria.

## Layout

```
AGENTS.md                 this file
README.md                 research + project map
nm-formulas.md            NM rules per regulation
research-sources/         product ST / NM / AT spreadsheets + AT scoring doc (not engine SoT)
config-prod/              live ClientRiskProfileConfiguration snapshots
build_workbook.py         → eToro-suitability-test-calculator.xlsx
verify_workbook.py
build_nm_workbook.py      → eToro-negative-market-calculator.xlsx
verify_nm_workbook.py
explainer/                Next.js spike (suitability + NM tabs; AT placeholder)
app-handoff/              build brief for the app (HANDOFF, DATA-CONTRACT, MANIFEST)
```

## Commands

Python (repo root):

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python build_workbook.py && .venv/bin/python verify_workbook.py
.venv/bin/python build_nm_workbook.py && .venv/bin/python verify_nm_workbook.py
```

Explainer:

```bash
cd explainer && npm install && npm run check && npm run dev
```

Synthetic examples only until SSO + audit log exist. Do not point Cosmos at real data for anyone but the author.

## Where work stopped (2026-08-24)

**Done**

- Suitability workbook + 47-scenario verifier.
- NM workbook + 29-scenario verifier: CySEC, FCA, ASIC, ASIC GAML (Typeform one row per question; UK overlay **FCA only**), FSRA, MAS CKA (CFD) and **CAR (ETF)** as a copy of CKA.
- Explainer: tree, outcome states, config load, coverage, kind-explicit ids, read-only Cosmos/API stubs, tests. See `explainer/README.md` Status.

**Not done (priority)**

1. Explainer: render **NM per product** (and MAS CAR) next to suitability — original product ask: check NM, suitability, appropriateness per GCID, treated separately. Appropriateness still out of scope until researched.
2. Explainer: show the **operation** on each tree node (Min / floor Avg / Max) from the user's config.
3. Auth (SSO) and audit log before any shared real-data use.
4. Live CID resolution through the app (`DATABRICKS_TOKEN`).
5. Answer copy from `compliance-kycx-staticdata` (gate G4 in handoff).
6. Refresh `config-prod/` (ASIC GAML already newer in prod than the v15 snapshot).

## NM modelling notes the next agent will trip on

- **ASIC GAML CFD/Futures Typeform** comes from `Copy of Futures Suitability Test_V04`, not from guessed Stage-2 questions. One question = one row. Scope: Q1–Q6 both products, Q7–Q8 CFD only, Q9–Q11 Futures only.
- **GAML Futures NM is not in `ASICGAML-15.json`**. Spec from the spreadsheet.
- **MAS `EtfNegativeMarket` is not on `MAS-12.json`**. CAR is modelled as a copy of CKA on `HaveYouTransactedEtf` + three CAR criteria. Product copy mentions “≥ 6 ETF trades in 3 years”; the KYC question is binary.
- Count dropdowns in Excel must be **numeric** (`0` not `"0"`) or `>=` compares as text.

## Config vs spreadsheet

When they disagree, say so in the workbook notes. Do not silently pick one. Live Cosmos documents in `config-prod/` are the engine; the GAML Typeform spreadsheet is the product SoT for those knockouts until the config catches up.
