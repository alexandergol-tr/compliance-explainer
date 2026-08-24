# Manifest — what travels, and how to check it arrived

Companion to [HANDOFF.md](HANDOFF.md). This exists because the receiving environment may not have the repos this pack was written in, and a handoff that silently loses half its references is worse than no handoff — it reads as complete while its citations dangle.

---

## 1. The pack itself

Copy the whole `rev-eng/suitability-test/` directory. It is ~250 KB and self-contained.

| File | Role | Needed for |
|---|---|---|
| `app-handoff/HANDOFF.md` | The brief | Start here |
| `app-handoff/DATA-CONTRACT.md` | Sources, shapes, id maps, queries | Every phase |
| `app-handoff/MANIFEST.md` | This file | Arrival check |
| `tech.md` | Formula reference. §4.3 is every answer→level mapping; §6.4 is where user data lives | Phases 1 and 4 |
| `verification.md` | Every claim graded by confidence, plus a Gaps section | **Before trusting anything** |
| `product.md` | Product rules, open questions, known defects | Phase 1 copy and edge cases |
| `prod-validation.md` | What was confirmed against production data, and the residual 0.04% | Phase 4 |
| `bff.md` | Existing client/BFF surface for suitability | Phase 2, if you reuse anything |
| `README.md` | Index over the above | Orientation |
| `config-prod/*.json` | **The five live configuration documents**, plus MAS | Phase 1 — may remove the need for any Cosmos access |
| `eToro-suitability-test-calculator.xlsx` | Working calculator, one tab per regulation | UI reference, and phase-4 oracle |
| `build_workbook.py`, `verify_workbook.py` | Regenerate and self-test the workbook | Only if you change scoring tables |

Do **not** copy `~$eToro-suitability-test-calculator.xlsx` if present — it is an Excel lock file, not content.

---

## 2. The workbook is your UI reference and your oracle

`eToro-suitability-test-calculator.xlsx` already does, in spreadsheet form, most of what the app must do on screen: one tab per regulation, answers as inputs, the factor/component structure visible, hard-block conditions broken out as one row per condition with a `Met?` column, and monitoring modelled separately.

Two uses. **Design**: it is a working answer to "how do you lay out a calculation so a non-engineer can follow it", already reviewed by the people who will use the app. Steal the layout rather than reinventing it. **Testing**: `verify_workbook.py` asserts 47 scenarios across the five tabs, including ten component-8 vectors lifted from the service's own unit tests and the six-rung production score ladder. Those scenarios are a ready-made fixture set for phase 4 — if your recomputation disagrees with the workbook on any of them, your recomputation is wrong.

Running it needs `openpyxl`, and the verifier also needs `formulas`:

```bash
python -m venv .venv && .venv/bin/pip install openpyxl formulas
.venv/bin/python verify_workbook.py              # all tabs
.venv/bin/python verify_workbook.py "FCA v15"    # one tab
```

---

## 3. External repos referenced, and what to do without them

Citations in this pack point into six repos. The table says what each is needed for and whether the pack survives its absence.

| Repo | Needed for | If unavailable |
|---|---|---|
| `KYCAnalyzer` | The service: controllers, domain models, calculators, SQL repository | **Blocking for gate G1.** Model shapes are transcribed into DATA-CONTRACT §2, so you can design against them — but you cannot verify the AutoMapper question without either the source or a live response |
| `kycanalyzer-nuget` | Enums: `RiskLevel`, `BlockResult`, `RecalculationReason`, `Regulation`, `KycQuestion`, `KycAnswer` | **Blocking for gate G4.** The four small maps are reproduced in DATA-CONTRACT §4, but the full question and answer id lists are hundreds of members and are not |
| `ComplianceDBs` | SQL schema for `Analyzer.Suitability` and `Analyzer.SuitabilityCalculationDetail` | Recoverable — DDL is transcribed in DATA-CONTRACT §3, and `SELECT * FROM INFORMATION_SCHEMA.COLUMNS` gives you the rest if you have the DB |
| `compliance-kycx-staticdata` | Customer-facing question and answer text via POEditor keys | Degrade to enum identifiers as the fallback, per DATA-CONTRACT §4.5 |
| `compliance-kycx-kns` | Funnel flow graph — which questions are asked, in what order, per flow | Only needed if the app explains the *funnel* as well as the scoring. Not required for any phase |
| `compliance-kycx-nugets` | The authoritative `Regulation` enum, shared contracts | Overlaps `kycanalyzer-nuget`; ids are in DATA-CONTRACT §5 |

**If `KYCAnalyzer` and `kycanalyzer-nuget` are both unavailable in the target environment, say so before starting.** Phase 1 is still buildable from `config-prod/` alone, but gates G1 and G4 cannot close, which means phases 2 and 4 are blocked on access you do not have. That is a scoping conversation, not something to work around.

---

## 4. Arrival check

Run this in the copied directory. It verifies the pack is complete and reports which external repos you can reach.

```bash
# 1. Pack completeness
for f in app-handoff/HANDOFF.md app-handoff/DATA-CONTRACT.md tech.md verification.md \
         product.md prod-validation.md bff.md README.md \
         eToro-suitability-test-calculator.xlsx build_workbook.py verify_workbook.py; do
  [ -f "$f" ] && echo "ok   $f" || echo "MISSING $f"
done
ls config-prod/*.json | wc -l    # expect 8

# 2. Workbook self-test — proves the scoring tables survived the copy
python -m venv .venv && .venv/bin/pip -q install openpyxl formulas
.venv/bin/python verify_workbook.py     # expect 47 scenarios, 0 failures

# 3. External repos, from the parent of your repo checkouts
for r in KYCAnalyzer kycanalyzer-nuget ComplianceDBs \
         compliance-kycx-staticdata compliance-kycx-kns compliance-kycx-nugets; do
  [ -d "$r" ] && echo "have $r" || echo "no   $r"
done
```

If step 2 fails, the pack is corrupt or a scoring table was edited in transit — stop and resolve it, because every downstream comparison inherits the error.

---

## 5. First actions, in order

1. Run the arrival check above.
2. Read `HANDOFF.md` end to end. Sections 4 (guardrails) and 5 (gates) are the ones that change your design.
3. Close gates **G1** and **G3** — does the API preserve the tree, and which access path can you actually be granted. Write the answers into `HANDOFF.md` §5 so the next reader inherits them.
4. Read `verification.md` §4 (Gaps) before relying on any claim in this pack.
5. Then, and only then, start phase 1.

---

## 6. Provenance

This pack is the output of a reverse-engineering investigation into eToro's suitability test, conducted against the legacy Angular client, the `KYCAnalyzer` service source, five production configuration documents, and production answer data via the data lake. It is **reverse-engineered documentation, not a specification maintained by the owning team.**

The practical consequence: `verification.md` grades every load-bearing claim, and claims marked below **High** confidence should be re-checked against source before you build on them. Where this pack and the live service disagree, the service is right and this pack has drifted — and a note back to whoever handed you this is worth more than a local fix.
