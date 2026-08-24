# Negative Market — formulas per regulation

Same method as the suitability work: the live `ClientRiskProfileConfiguration` documents in [config-prod/](config-prod/) are the engine input. Spreadsheets and Confluence lose where they disagree.

Read 2026-08-09 (MAS 2026-08-10). No client profiles were queried.

This is **not** the copy-trading suitability test. NM is a per-product knockout (`Blocked` / `NotBlocked` / occasionally `Warning`) that gates leveraged and other complex products. It shares KYC answers and the knowledge-assessment scorer with suitability; it does not share the factor tree, the authorised risk score, or the copy-utilisation monitor.

---

## 1. How to read a Negative Market block

Each product key is an independent formula. A profile stores one result per key that exists on that regulation’s config. **Missing key ≠ NotBlocked.** MAS v12 has `Cfd` (and historically `Etf` on stored profiles) and no suitability section at all.

| Config key | Product |
|---|---|
| `CfdNegativeMarket` | CFD / leveraged |
| `FuturesNegativeMarket` | Exchange-traded futures |
| `MarginNegativeMarket` | Stock margin (SMT) |
| `CryptoNegativeMarket` | Crypto (FSRA top-level; UK overlay elsewhere) |
| `ExperimentalCryptoNegativeMarket` | Lowest-appetite crypto overlay |
| `ErsNegativeMarket` | Elevated-risk securities |

### 1.1 Engine shape (every regulation)

```
for each Rule in product.Rules:          # KnockOut, TradingExperience, …
    evaluate Checks (Any / All / LessThan + nested)
    if Rule.HasAutoRelease and FTD+closed-trades meet AutoReleaseCondition:
        that rule does not keep the user blocked
product result = combine rule results    # see caveat below
```

Rules on one product are **independent**. Passing `TradingExperience` (or auto-releasing it) does not clear `KnockOut`. That is the whole point of splitting them.

**Caveat — combining rules.** The config does not declare an outer `Any`/`All` over rules. The working model, matching how the blocks are authored, is: **the product is blocked if any still-active rule evaluates to `Blocked`.** That matches `CalculateWithBlockResult` as described in Confluence, but this pack has not re-traced the C# aggregator the way suitability did. Do not ship an explainer that *recomputes* a verdict until that path is read.

**Caveat — `DefaultResult` is live here.** Suitability never calls `CalculateWithBlockResult`, so `Check.DefaultResult` is dead on the copy path. NM *does* call that method. CySEC, FCA, ASIC GAML and MAS v12 set `DefaultResult: Blocked` on many checks (fail closed when the check cannot be evaluated). FSRA, ASIC v9, MAS v2 and regulation `13` v1 omit it on several checks — engine default then applies. Do not assume FSRA fails closed because CySEC does.

**Caveat — auto-release is not in the KYC document.** `DaysFromFtd` + `AmountOfClosedTradingPosition` need FTD and a closed-position count from trading. Replaying answers+config without that will report “still blocked” for users the engine already released.

### 1.2 Knowledge assessment (shared scorer, NM cutoff)

Same `GetScoreByAnswerIds` table as suitability component 8: tick a statement to take its `Score`, leave it unticked to subtract it. Cutoff on NM is **not** the four risk bands:

```
score <  -3  → Blocked      (MinTotalScore -100)
score >= -3  → NotBlocked
```

A retired sixth statement still sits in CySEC/FCA/ASIC/FSRA CFD groups and contributes a constant `+2`. Suitability [tech.md §4.3.1](tech.md) already showed that this **does not change** any NM pass/fail, because thresholds are 4 apart and the offset is 2.

Crypto UK overlay uses the **verity** path instead (`IsCorrect` + Yes/No free text, `MinTotalScore: 5` to unblock). Suitability never takes that path.

### 1.3 What is in this snapshot vs what is not

| In `config-prod/` | NM products |
|---|---|
| CySEC v24 | CFD, Futures, Margin, Experimental crypto |
| FCA v15 | CFD, Futures, Experimental crypto, ERS |
| FSRA v10 | CFD, Crypto |
| ASIC v9 | CFD |
| ASIC GAML v15 | CFD, Experimental crypto |
| MAS v12 | CFD only (CKA-shaped; no suitability) |
| MAS v2 | CFD (legacy, pre-CKA) |
| `13-1` (regulation id 13, v1) | CFD, ERS — historical MAS-shaped id |

**Not in this folder:** FSA/Seychelles, CySEC country overrides other than UK, FINRA/US, offshore, older CySEC/FCA versions. Production has ~104 configuration documents; this is the same eight-document cut used for suitability.

**UK overlay (`Countries[218]`, GB)** is copy-pasted onto every document except MAS v12. It only binds when the user’s `CountryId` is 218 **and** they are scored under that regulation’s document. A CySEC user with `CountryId = 218` would be a data mess (UK is FCA); treat the overlay as live for **FCA**, and as likely dead config on the other snapshots until a profile proves otherwise.

---

## 2. Cross-regulation CFD picture

`CfdNegativeMarket` is the only product every snapshot has. **They are not one formula.**

| | KnockOut | TradingExperience | Extra | Auto-release |
|---|---|---|---|---|
| **CySEC v24** | Appetite `+5/−3` **OR** income `UpTo10K` | Nested: no crypto **and** no CFD **and** no knowledge, **and** failed knowledge tests (legacy quiz **or** either 5-question set with &lt; 3 correct) | — | **60d / 20** closed |
| **FCA v15** | Same two OR legs, **plus** two pensioner/low-means `All` checks | Same nested shape as CySEC; quiz statement names differ slightly | — | **30d / 5** |
| **FSRA v10** | Appetite `+5/−3` **OR** income `UpTo10K` | Flat `All`: never crypto **and** never CFD **and** no knowledge **and** quiz &lt; −3 | — | **30d / 5** |
| **ASIC v9** | Appetite `+5/−3` **OR** purpose `SavingsForHome` **OR** income `UpTo10K`/`Between10KAnd50K` **OR** assets `UpTo10K` | Same flat `All` as FSRA | — | **30d / 5** |
| **ASIC GAML v15** | Appetite `+5/−3` **or** `+10/−6` **OR** income to 50K **OR** assets `UpTo10K` **OR** `IncomeSource = Pension` (no purpose leg) | Same flat `All` as FSRA | **`CfdRiskAssessment`** — fail-closed unless 8-question vector **or** `CfdRiskAssessmentPassed = Yes` | **30d / 5** (experience only) |
| **MAS v12** | `HaveYouTransactedCFD = No` **AND** `CkaTradingKnowledge = NoFinancialKnowledge` | Inverted: `NotBlocked` if transacted CFD **OR** listed CKA degree **OR** certificate **OR** work experience | `ReassessmentTtl` **364 days** | **none** |
| **MAS v2 / 13-1** | Appetite `+5/−3` **OR** income `UpTo10K` | Flat `All` like FSRA | 13-1 also has ERS knockout | **30d / 5** |

FSRA discovery (`fsra-cascaded-kyc/04-fsra-formulas.md`) left a three-way conflict on appetite (`+5/−5` vs `+5/−3`) and income (`< 10K` vs `< 50K`). **Production FSRA-10 is `Plus5ToMinus3Percent` and `UpTo10K` only.** The workbook’s “FCA, FSA, UAE share one formula” line is also false: FCA has two extra KnockOut checks FSRA does not.

The CySEC *suitability* hard block (appetite **and** purpose **and** income &lt; 200K **and** assets &lt; 200K) is **not** the CySEC NM KnockOut. NM KnockOut is the two-leg OR above.

---

## 3. Per regulation

Answer identifiers are config enum **names**, not UI copy.

### 3.1 CySEC v24 — [CySEC-24.json](config-prod/CySEC-24.json)

Top-level `DefaultResult: Blocked` on CFD / Futures / Margin. Cooling-off duration is `00:00:00` (present, inert).

**CFD / Futures / Margin KnockOut** (identical):

```
BLOCK if
    RiskAppetite = Plus5ToMinus3Percent
 OR AnnualIncome = UpTo10K
```

Retry throttle on those questions: attempt ≥ 2, 1 day apart.

**CFD / Futures / Margin TradingExperience** (identical structure; 60 days / 20 closed trades):

Outer check is `All` → `Blocked` (fail closed).

1. Nested `All` → `Blocked` if:
   - `Crypto = NeverTraded` **and**
   - `LeveragedCfd = NeverTraded` **and**
   - `TradingKnowledge = NoFinancialKnowledge`
2. Nested `Any` / `IsAlternative` / result `NotBlocked` (fail closed): the user stays blocked unless they pass **one** of:
   - legacy knowledge quiz: same ±2 table, `NotBlocked` if score ≥ −3
   - 5-question set A: `LessThan` `MinCount: 3` correct answers → `Blocked`  
     (stop-loss cancellable, slippage, margin close-out, leverage amplifies, can lose more than stake)
   - 5-question set B: same `LessThan 3` on spread / main risk / stop-loss placement / stop-loss purpose / margin call on a winning trade

Reading the nest without the C# is the weakest part of this document. The **intent** is: inexperienced **and** failed the knowledge gate. The alternative flag and inverted `NotBlocked` result are why this must be confirmed against `CheckCalculator` before an explainer replays it.

**Experimental crypto KnockOut:** `RiskAppetite = Plus5ToMinus3Percent` only. `DefaultResult: NotBlocked`. No auto-release.

Futures and Margin copies of TradingExperience are not independently authored — they are the CFD experience block pasted onto two other products.

### 3.2 FCA v15 — [FCA-15.json](config-prod/FCA-15.json)

**CFD KnockOut** — three checks, any check that applies can block (`Any` then two `All`s):

```
(1) BLOCK if RiskAppetite = Plus5ToMinus3Percent
         OR AnnualIncome   = UpTo10K

(2) BLOCK if ALL of:
      IncomeSource ∈ {Pension, Salary}     # Condition: All — see note
      AnnualIncome ∈ {LessThan25K, Between10KAnd25K, Between25KAnd50K,
                      UpTo10K, Between10KAnd50K}
      LiquidAssets ∈ {LessThan25K, Between10KAnd25K, Between25KAnd50K,
                      UpTo10K, Between10KAnd50K, Between50KAnd200K,
                      Between200KTo500K}
      Occupation   ∈ {NoOccupation, Retired}

(3) BLOCK if ALL of:
      IncomeSource = Pension
      AnnualIncome ∈ (same list as (2))
      LiquidAssets ∈ (same list as (2))
```

Income bands look like two questionnaires glued together (`UpTo10K` next to `LessThan25K`). A user can only hold one current answer; the union is “whichever catalogue they were shown”.

**Note on check (2) `IncomeSource` `Condition: All` with `{Pension, Salary}`.** If income source is single-select, both values can never be true and the check never applies. If it is multi-select, it means the user ticked both. Do not silently rewrite this as `Any`. Trace `QuestionAnswersCalculator` before treating (2) as “pension *or* salary”.

**CFD TradingExperience:** CySEC-shaped nest, auto-release **30 / 5**. One quiz wrong-answer name differs (`IfThePriceOfGoogleStockOnNasdaqGoesUp…` instead of `NewerCfd`).

**Futures KnockOut / TradingExperience:** same pattern as CFD. Occupation field on futures check (2) is `Occupation` with `NoOccupation` / `Retired`, not `Occupation`. Do not normalise the two names.

**Experimental crypto:** appetite `+5/−3`. Check `DefaultResult: Blocked` (unlike CySEC’s `NotBlocked` on the same rule).

**ERS KnockOut:** appetite `+5/−3` **OR** income `UpTo10K`. No experience rule, no auto-release.

### 3.3 FSRA v10 — [FSRA-10.json](config-prod/FSRA-10.json)

Older schema: no product-level `DefaultResult`, many check-level defaults omitted.

**CFD KnockOut:**

```
BLOCK if RiskAppetite = Plus5ToMinus3Percent
      OR AnnualIncome  = UpTo10K
```

**CFD TradingExperience** — flat `All` (no CySEC nest, no 5-question sets):

```
BLOCK if Crypto = NeverTraded
     AND LeveragedCfd = NeverTraded
     AND TradingKnowledge = NoFinancialKnowledge
     AND knowledge-quiz score < -3
```

Auto-release **30 / 5**.

**Crypto (top-level, `OnlyDirectTradeRestriction: true`):**

```
BLOCK if RiskAppetite = Plus5ToMinus3Percent
```

No experimental-crypto key on FSRA-10. The “Exp Crypto NM live 11 Mar 2025” timeline in the FSRA pack is **not** on this document. Either it never landed in v10, or it lives in a later version we do not have.

### 3.4 ASIC v9 — [ASIC-9.json](config-prod/ASIC-9.json)

**CFD KnockOut** (`Any` — one hit blocks). Attempt throttle: from attempt 1, 7 days.

```
BLOCK if RiskAppetite   = Plus5ToMinus3Percent
      OR TradingPurpose = SavingsForHome
      OR AnnualIncome  ∈ {UpTo10K, Between10KAnd50K}
      OR LiquidAssets   = UpTo10K
```

**TradingExperience:** FSRA-flat `All` of never crypto / never CFD / no knowledge / quiz &lt; −3. Auto-release **30 / 5**.

No experimental crypto on v9. ASIC GAML v15 added it.

### 3.5 ASIC GAML v15 — [ASICGAML-15.json](config-prod/ASICGAML-15.json)

**CFD KnockOut** (`Any`):

```
BLOCK if RiskAppetite  ∈ {Plus5ToMinus3Percent, Plus10ToMinus6Percent}
      OR AnnualIncome ∈ {UpTo10K, Between10KAnd50K}
      OR LiquidAssets  = UpTo10K
      OR IncomeSource  = Pension
```

No `SavingsForHome` leg (ASIC v9 has it; GAML replaced it with pension + wider appetite). 7-day retry from attempt 1.

**TradingExperience:** FSRA-flat `All`, auto-release **30 / 5**, same 7-day retry.

**`CfdRiskAssessment`** (no auto-release, rule `DefaultResult: Blocked`):

Outer check `Any` / `IsAlternative` / result `NotBlocked` / `DefaultResult: Blocked` — fail closed unless one nested `All` passes:

- Eight Typeform-style questions, all required, exact answers:  
  losses can exceed gains = Yes; own the underlying = No; can lose entire amount = Yes; 25% distress = No; material hardship = No; margin-call stress = Yes; duration ∈ {up to several days, few weeks to a month}; purpose ∈ {leverage, diversify, speculate, hedge}. Purpose retried every 30 days.
- **Or** `CfdRiskAssessmentPassed = Yes` (30-day retry).

**Experimental crypto KnockOut:** appetite `+5/−3` **or** `+10/−6`.

### 3.6 MAS v12 — [MAS-12.json](config-prod/MAS-12.json)

Different product. No risk-appetite knockout, no ±2 quiz, no auto-release. Product `DefaultResult: Blocked`. `ReassessmentTtl: 364.00:00:00`.

**KnockOut** (`All` → `Blocked`):

```
BLOCK if HaveYouTransactedCFD = No
     AND CkaTradingKnowledge  = NoFinancialKnowledge
```

**TradingExperience** (name reused; this rule *unblocks*):

```
NotBlocked if HaveYouTransactedCFD = Yes
           OR CkaAcademicQualification ∈ {Accountancy, ActuarialScience,
                BusinessAdministration, BusinessManagementStudies, CapitalMarkets,
                Commerce, ComputationalFinance, Economics, Finance,
                FinancialEngineering, FinancialPlanning, Insurance}
           OR CkaProfessionalCertificate ∈ {ACCA, AFP, AWP, CFP, CTE, FRM,
                CAIA, CFA, CHFC, CPA, CISI}
           OR CkaWorkExperience ∈ {Accountancy, ActuarialScience,
                FinancialRiskManagement, DevelopmentOfInvestmentProducts,
                StructuringOfInvestmentProducts, ManagementOfInvestmentProducts,
                SaleOfInvestmentProducts, TradingOfInvestmentProducts,
                ResearchAndAnalysisOfInvestmentProducts,
                ProvisionOfTrainingInInvestmentProducts, Treasury,
                ProvisionOfLegalAdviceOrPossessionOfLegalExpertise}
```

Degree/certificate/work questions are `IsRequired: false`. Rule and check `DefaultResult: Blocked`.

MAS v2 is **not** this formula — it is the FSRA-shaped appetite/income + 30/5 experience block. Do not use v2 to explain a current MAS user.

### 3.7 UK crypto overlay — `Countries[218]`

Present on 13-1, ASIC-9, ASIC GAML-15, CySEC-24, FCA-15, FSRA-10, MAS-2. Absent on MAS-12.

```
DefaultResult: Blocked
OnlyDirectTradeRestriction: true
CoolingOffPeriodDuration: 1.00:00:00     # 1 day
```

Unblock requires **both** rules (`All` → `NotBlocked`, rule default `Blocked`):

1. **Crypto knowledge assessment** — verity scorer, `MinTotalScore: 5` to `NotBlocked`. Empty `Answers` list on the question check; statements are `{IsCorrect: true, AnswerValue: "Yes", Score: 1}` / `{IsCorrect: false, AnswerValue: "No", Score: 1}`. Retries: attempts 2–5 wait 1 day; attempt ≥ 5 wait 7 days.
2. **Classification questionnaire** — `All` of:
   - `IConfirmExposeHighNetWorthInvestor = Yes`
   - `IConfirmExposeSophisticatedInvestor = Yes`

On FCA-15 the knowledge rule’s check `DefaultResult` is `Blocked`; on CySEC-24 / ASIC GAML it is `NotBlocked`. Same overlay, not the same fail-open behaviour.

---

## 4. Shared with suitability — and must not be merged

| Input | Suitability | Negative Market |
|---|---|---|
| Knowledge quiz score | Four bands (`High` needs ≥ 6) | Pass/fail at **−3** |
| Appetite `+5/−3` | One of four AND-legs on the **copy** hard block (CySEC) | **OR** knockout on CFD (and others) |
| Income `UpTo10K` | Not a standalone ST block | Standalone NM knockout (most regs) |
| Income `Pension` | ASIC GAML ST hard block (fifth AND-leg) | ASIC GAML **and** FCA NM knockout (OR / extra checks) |
| MAS | No `Suitability` property from v3 | Live CFD NM (CKA) |
| Auto-release | None (copy monitor is daily solvency) | FTD days + closed trades, per experience rule |
| Country 218 | Not in ST config | Crypto NM overlay |

Coverage in the explainer today labels NM-only answers as “not used”. That is the same class of bug already fixed for income/assets vs the ST hard block.

---

## 5. What is still unknown

| # | Question | Why it blocks an explainer |
|---|---|---|
| N1 | Exact C# combination of multiple `Rules` on one product | Replay vs stored result |
| N2 | CySEC/FCA nested `TradingExperience` + `IsAlternative` evaluation order | Easy to invert pass/fail |
| N3 | `QuestionAnswerCheck.Condition: All` on FCA income-source `{Pension, Salary}` | Check (2) may be dead |
| N4 | Stored `ProductNegativeMarkets` payload (rule names? cooling-off timestamps? manual ops flags?) | UI types |
| N5 | Whether FSA (Seychelles) still equals FSRA-10 | Not in this snapshot |
| N6 | Experimental crypto on FSRA after v10 | Timeline says yes; v10 has no key |
| N7 | ETF NM (`EtfNegativeMarket`) | Mentioned on MAS stored profiles in suitability verification; **not** on MAS-12 config |

Until N1–N4 are closed, the explainer should **render the stored per-product result and show these predicates as the config that produced it**, not recompute a verdict.

---

## 6. Suggested next step

Point-read two production `ClientRiskProfile` documents: one CySEC CFD-blocked, one MAS v12. Dump `ProductNegativeMarkets` only. That answers N4 and shows whether CySEC stores one CFD flag or a per-rule breakdown. Then trace `CalculateWithBlockResult` for N1–N2.

Do not extend the explainer until that shape is measured. The suitability work made the same call: config first, stored tree second, calculator third — never a second implementation of the engine.
