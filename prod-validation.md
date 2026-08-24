# Validating the model against production answers

What to pull from the `ClientRiskProfile` container to test the documented formula — and the workbook — against what the engine actually computed.

This container holds **client data**, unlike `ClientRiskProfileConfiguration`. Everything below is scoped to the minimum needed to reproduce a score, and deliberately omits the user identifier.

---

## 1. The document

`ClientRiskProfile`, same Cosmos account as the config container (`prod-kycanalyzer`). One document per user, `id` = GCID as a string. Shape from `ClientRiskProfileResult` `[code]`.

Two halves matter: the **inputs** the engine read, and the **result** it stored. Pulling both gives you self-contained test vectors — you never have to join anything.

### Inputs

| Field | Why you need it |
|---|---|
| `Regulation` | Picks which config scores the user |
| `ConfigurationVersion` | **Picks which *version*.** Not necessarily the latest — see §4 |
| `QuestionsAnswers[]` | `{ QuestionId, AnswerIds }`. The actual answers. Filter to the 20 ids in §2 |
| `VerificationLevel` | Below 2, suitability is not calculated at all |
| `CountryId` | `250` is the internal eToro-staff country, which is force-passed |
| `FtdDate` | Drives "years since FTD" in the financial-sustainability formula |

### Expected results

| Field | What it pins |
|---|---|
| `Suitability.ClientRiskLevel` | The headline outcome. Maps to the authorised risk score |
| `Suitability.SuitabilityBlock` | The G1 hard block |
| `Suitability.IsAllQuestionsAnswered` | Distinguishes a real score from a partially-answered one |
| `Suitability.SuitabilityCalculationDetails` | **The most valuable field by far** — the full result tree, `{ Name, ClientRiskLevel, Childs }` nested factor → component → question. Lets you compare component by component instead of only the final answer |
| `Suitability.OngoingMonitoring` | `{ FtdDate, FinancialSustainability, CopyUtilization, ManuallyUnblocked }` — the G3 daily check |
| `Suitability.RevolvingDoorQuestions` | Which questions the UI offers to re-answer |
| `RecalculationReason`, `UpdatedOn`, `LastAnswerOccurredAt` | Staleness and context when something disagrees |

`SuitabilityCalculationDetails` is what turns this from a pass/fail into a diagnosis. If the final level matches but component 8 doesn't, you know exactly which rule is wrong.

---

## 2. Only twenty questions are read

`QuestionsAnswers[]` carries the user's **entire** KYC history — employment, tax residency, source of wealth, and much else. The suitability formula reads twenty ids. Projecting only those is both a smaller extract and a much narrower data-protection footprint.

| Consumer | Question ids |
|---|---|
| C1 experience frequency | 33, 34, 35 |
| C2 invested amounts | 45, 47, 48 |
| C3 trading knowledge | 3 |
| C4 trading strategy | 5 |
| C5 purpose of trading | 8 |
| C6 risk appetite | 9 |
| C7 source of income | 15 |
| C8 knowledge assessment | 23 |
| C9 MiCA crypto *(CySEC only)* | 211, 212, 213, 214, 215 |
| G1 hard block | 10, 11 |
| Financial sustainability | 10, 11, **14** (investment plan) |

Question 14 is easy to miss — it feeds the financial-sustainability formula only, never the risk level, and it is the third of the three answers that must all be present or the whole calculation returns `null`.

**Watch the namespace collision:** question 212 is `MiCACryptoAssessmentCyberRisks`; answer 212 is `NewerCfdTrs`, the retired knowledge statement. Same number, unrelated.

---

## 3. The query

```sql
SELECT
    c.Regulation,
    c.ConfigurationVersion,
    c.VerificationLevel,
    c.CountryId,
    c.FtdDate,
    c.UpdatedOn,
    c.LastAnswerOccurredAt,
    c.RecalculationReason,
    ARRAY(
        SELECT qa.QuestionId, qa.AnswerIds
        FROM qa IN c.QuestionsAnswers
        WHERE ARRAY_CONTAINS(
            [3, 5, 8, 9, 10, 11, 14, 15, 23, 33, 34, 35, 45, 47, 48, 211, 212, 213, 214, 215],
            qa.QuestionId)
    ) AS Answers,
    c.Suitability.ClientRiskLevel,
    c.Suitability.SuitabilityBlock,
    c.Suitability.IsAllQuestionsAnswered,
    c.Suitability.RevolvingDoorQuestions,
    c.Suitability.OngoingMonitoring,
    c.Suitability.SuitabilityCalculationDetails
FROM c
WHERE IS_DEFINED(c.Suitability.ClientRiskLevel)
  AND c.VerificationLevel >= 2
  AND c.CountryId != 250
OFFSET 0 LIMIT 500
```

Note what is **not** selected: no `id`, no `Gcid`, no free-text answers. The extract is a set of anonymous input→output pairs, which is all a formula test needs. If you later need to trace one row back to a user, re-query that single document rather than carrying identifiers through the whole set.

Sample per regulation rather than taking the first 500 overall — CySEC will otherwise dominate and component 9 is the part most worth testing. Add `AND c.Regulation = "CySEC"` and run it five times.

---

## 4. Three things that will look like model failures but are not

**Version skew.** A user is scored by whatever version was current at their last recalculation, which may be older than the latest. `ConfigurationVersion` tells you which. `config-prod/` only holds the latest per regulation, so any row whose version is older needs that version pulled too, or it should be excluded. Check the distribution of `ConfigurationVersion` before comparing anything — if it is mostly the latest, exclude the rest and move on.

**The two bypasses.** Below verification level 2 nothing is calculated, and users in country `250` with `FeatureFlagAlwaysAllowCopyForEtorians` on are forced to `High`/`NotBlocked` regardless of answers. Both are filtered above. There is a third — a CCM list `SkipCalculationForUsers.Gcids` that skips named users — which you cannot filter without GCIDs; expect a handful of unexplained rows and don't chase them.

**Unanswered versus absent.** A question missing from `QuestionsAnswers` falls back to the default risk level rather than being an error, so a sparse row can still produce a perfectly valid score. Use `IsAllQuestionsAnswered` to separate the two populations before concluding anything about a mismatch rate.

---

## 5. What a good result looks like

Compare in this order, because each answers a different question:

1. **Per-question levels** in `SuitabilityCalculationDetails` — validates the answer→risk-level tables in `tech.md` §4.3.
2. **Per-component levels** — validates the `Max`/`Avg`/`Round: Down` operations and the component defaults, notably C9's `Low`.
3. **Factor A and B, then `ClientRiskLevel`** — validates the `Min` composition.
4. **`SuitabilityBlock`** — validates the G1 conditions, including the ASIC GAML and FCA divergences.
5. **`OngoingMonitoring.FinancialSustainability`** — the one number that depends on live CCM values rather than the config document, so treat a mismatch here as a CCM-drift signal rather than a formula error.

Two specific things this dataset can settle that nothing else can:

- **How often the question-8 gap actually fires** (§6.3 of `tech.md`). Count non-CySEC rows whose Q8 answer is 900, 901, 902 or 903. That converts a config observation into a real exposure number, which is what the compliance decision in OQ-9 needs.
- **Whether any user ever answered the retired statement 212** on question 23. If some did, they predate its removal, and their stored scores are the only ones where the six-statement arithmetic was genuinely exercised.
