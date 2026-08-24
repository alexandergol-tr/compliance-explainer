# Data contract

Companion to [HANDOFF.md](HANDOFF.md). Everything here is read from source in the repos named below; citations are `repo/path` relative to the repo root so you can re-verify each one. Where a fact is inferred rather than observed it is marked **unverified** — those are the ones that will bite.

Confidence grades for the underlying reverse-engineering live in `../verification.md`, claim by claim.

---

## 1. Access paths, and which to prefer

Four stores hold pieces of what the app needs. They are not interchangeable.

| # | Path | Gives you | Costs you |
|---|---|---|---|
| 1 | **`KYCAnalyzer` service API** | Current profile, answers, tree (subject to gate G1), plus configuration for explainer mode | No data-plane grant. Inherits the service's own behaviour. Current state only — no history |
| 2 | **`KycAnalyzer` SQL, read-only** | Result header, the flattened tree, **and full history** — both tables are system-versioned | Needs a DB grant. No `Regulation`, no `ConfigurationVersion` |
| 3 | **`ClientRiskProfile` Cosmos, read-only** | The authoritative document: everything above plus `Regulation` and `ConfigurationVersion` | Heaviest grant. Polymorphic tree you must deserialise yourself |
| 4 | **Data lake (`main.compliance.*`)** | Bulk analysis across users | Profile mirror is a **frozen snapshot, 2025-01-15 → 2025-01-23**, and drops `QuestionsAnswers`. Useless for a live per-user app |

**Recommendation.** Path 1 for phases 1–2, path 2 added for phase 3 (history), path 3 only if gate G1 fails and you need `ConfigurationVersion` for phase 4. Path 4 is for validation work, not for this app — it is listed so nobody rediscovers it and mistakes a January 2025 snapshot for live data.

---

## 2. The service API

Routes on `KYCAnalyzer/eToro.KYCAnalyzer/Controllers/`. Base paths are as declared; the host depends on your environment and is not recorded here.

### 2.1 Reads you want

| Route | Returns | Notes |
|---|---|---|
| `GET api/v1/kycanalyzer/clientRiskProfile/{gcid}` | `ClientRiskProfileResultDto` | The whole per-user picture. Subject to gate G1 |
| `GET api/v1/kycanalyzer/ClientRiskProfileConfiguration/{regulation}/country/{countryId}/current` | `ClientRiskProfileFlatConfigurationDto` | The **current** config for a regulation and country. This is the explainer-mode source |
| `GET api/v1/kycanalyzer/ClientRiskProfileConfiguration/{regulation}` | `ClientRiskProfileConfigurationDto[]` | All versions. Needed only if you support historical config lookup |

`{regulation}` binds to the `Regulation` enum, so it accepts either the name or the numeric id.

### 2.2 Writes on the same paths — never construct these

Restating the guardrail here because this is the document you will have open while writing the client.

| Route | Effect |
|---|---|
| `POST api/v1/kycanalyzer/clientRiskProfile/{gcid}` | Recalculates and overwrites one user's stored profile |
| `POST api/v1/kycanalyzer/ClientRiskProfileConfiguration/{regulation}` | Adds a configuration version |
| `PATCH api/v1/kycanalyzer/ClientRiskProfileConfiguration/{regulation}/{formulaConfigurationType}` | With `formulaConfigurationType = Suitability`, **changes the live scoring formula for an entire regulation** |

Neither controller declares `[Authorize]`.

### 2.3 The domain shape behind the profile DTO

`KYCAnalyzer/eToro.KYCAnalyzerService.Domain/ClientRiskProfile/Models/ClientRiskProfileResult.cs`:

```csharp
int Gcid; string Id /* = Gcid.ToString() */;
DateTime CreatedOn, UpdatedOn;
Regulation Regulation; int? CountryId; int? VerificationLevel;
int ConfigurationVersion;                    // which config produced the result
RecalculationReason? RecalculationReason;    // why it last ran
SuitabilityResult Suitability;               // null below verification level 2
DateTime? LastAnswerOccurredAt;              // needed for the phase-4 staleness rule
IReadOnlyList<QuestionAnswers> QuestionsAnswers;
```

`SuitabilityResult` (`…/Models/SuitabilityResult.cs`) — note that both headline fields are **nullable**, which is the absent-not-Minimal case:

```csharp
BlockResult? SuitabilityBlock;
RiskLevel? ClientRiskLevel;
KycQuestion[] RevolvingDoorQuestions;
OngoingMonitoringResult OngoingMonitoring;
SuitabilityResultNode[] SuitabilityCalculationDetails;   // the tree
bool? IsAllQuestionsAnswered;
```

The tree node hierarchy (`…/Models/SuitabilityResults/`):

| Type | Adds | Level id |
|---|---|---|
| `SuitabilityResultNode` (base) | `Name`, `ClientRiskLevel`, `Childs` | — |
| `FactorResult` | `RevolvingDoorOrder` | 1 |
| `ComponentResult` | nothing | 2 |
| `QuestionResult` | `KycQuestion Question` | 3 |

**This polymorphism is the whole of gate G1.** `Question` and `RevolvingDoorOrder` exist only on subclasses, and the AutoMapper profile at `KYCAnalyzer/eToro.KYCAnalyzerService.Application/MappingProfiles/ClientRiskProfile.cs` declares no `.Include<>()` for them. **Unverified** whether the DTO preserves them. Check the raw JSON before designing around it.

`OngoingMonitoringResult` — `BlockedByOngoingMonitoring` is a **computed** property, not stored logic you need to re-derive:

```csharp
ManuallyUnblocked == true            → false          // manual unblock wins
FinancialSustainability or CopyUtilization is null → null   // unknown, not false
CopyUtilization > FinancialSustainability → true
```

Render the null case as *not evaluated*. Collapsing it to "not blocked" asserts a check passed when it never ran.

### 2.4 Answers carry no text and no timestamp

`…/Models/QuestionsAnswers/QuestionAnswers.cs` is the entire type:

```csharp
public sealed record QuestionAnswers(int QuestionId, IReadOnlyList<int> AnswerIds);
```

A list because multi-select questions exist. Per-answer timestamps are not here — the profile carries a single `LastAnswerOccurredAt` for the user. If you need per-answer timing, it is `OccurredAt` on `UserApiDB.KYC.CustomerAnswers`, which is subject to the masking warning in HANDOFF §4.5.

---

## 3. SQL: the flattened tree

Schema in the `ComplianceDBs` repo under `KycAnalyzer/`. Both tables are system-versioned with history in the `History` schema, so `FOR SYSTEM_TIME` queries work.

### 3.1 `Analyzer.Suitability` — one header row per user

```
SuitabilityID (PK, identity)   GCID
SuitabilityBlockID             ClientRiskLevelID
FinancialSustainability        CopyUtilization
ManuallyUnblocked              BlockedByOngoingMonitoring
RecalculationReasonID          IsAllQuestionsAnswered
ValidFrom / ValidTo            -- PERIOD FOR SYSTEM_TIME → History.Suitability
```

**No `Regulation` column and no `ConfigurationVersion` column.** This is why a tree read from SQL cannot be attributed to the config that produced it (`../verification.md` C-52). If phase 4 needs the version, it comes from Cosmos or from the API.

### 3.2 `Analyzer.SuitabilityCalculationDetail` — one row per tree node

```
DetailID (PK, identity)        SuitabilityID → Analyzer.Suitability
ParentDetailID                 -- self-join; NULL at the roots
Name                           ClientRiskLevelID
QuestionID                     -- populated on level 3 only
RevolvingDoorOrder             -- populated on level 1 only
SuitabilityCalculationDetailLevelID   -- 1 factor / 2 component / 3 question
ValidFrom / ValidTo            -- → History.SuitabilityCalculationDetail
```

The writer is `KYCAnalyzer/eToro.KYCAnalyzerService.Persistent.Repositories/Repositories/ClientRiskProfileSqlRepository.cs` — `UpsertSuitabilityAsync` builds a table-valued parameter (`Analyzer.SuitabilityCalculationDetailList`) via `AddDetailsToTable`, which walks the tree and type-switches each node to populate exactly the columns above. Stored procedure: `Analyzer.UpsertSuitabilityByGCID`.

**Unverified: whether production rows are present, complete and current** (`../verification.md` C-51). That is gate G2, and it is one query:

```sql
SELECT COUNT(*) AS Nodes, COUNT(DISTINCT s.GCID) AS Users, MAX(s.ValidFrom) AS Latest
FROM Analyzer.SuitabilityCalculationDetail d
JOIN Analyzer.Suitability s ON s.SuitabilityID = d.SuitabilityID;
```

If `Latest` is recent and `Users` is in the hundreds of thousands, the table is live.

### 3.3 Rebuilding the tree

```sql
WITH tree AS (
    SELECT d.DetailID, d.ParentDetailID, d.Name, d.ClientRiskLevelID,
           d.QuestionID, d.RevolvingDoorOrder,
           d.SuitabilityCalculationDetailLevelID AS LevelID,
           0 AS Depth,
           CAST(RIGHT('0000000000' + CAST(d.DetailID AS varchar(10)), 10) AS varchar(400)) AS SortPath
    FROM Analyzer.SuitabilityCalculationDetail d
    JOIN Analyzer.Suitability s ON s.SuitabilityID = d.SuitabilityID
    WHERE s.GCID = @gcid AND d.ParentDetailID IS NULL

    UNION ALL

    SELECT c.DetailID, c.ParentDetailID, c.Name, c.ClientRiskLevelID,
           c.QuestionID, c.RevolvingDoorOrder,
           c.SuitabilityCalculationDetailLevelID,
           t.Depth + 1,
           CAST(t.SortPath + '.' + RIGHT('0000000000' + CAST(c.DetailID AS varchar(10)), 10) AS varchar(400))
    FROM Analyzer.SuitabilityCalculationDetail c
    JOIN tree t ON c.ParentDetailID = t.DetailID
)
SELECT REPLICATE('    ', Depth) + ISNULL(Name, '(unnamed)') AS Node,
       LevelID, ClientRiskLevelID, QuestionID, RevolvingDoorOrder
FROM tree
ORDER BY SortPath;
```

Two cautions. `Analyzer.Suitability` has a non-unique index on `GCID`, so **do not assume one current row per user** — check before relying on it, and add `ORDER BY ValidFrom DESC` plus a top-1 if there can be several. And for history, swap in `FOR SYSTEM_TIME AS OF @when` on **both** tables; using it on one gives you a header from one point in time joined to nodes from another.

---

## 4. Id → text, the four maps you need

### 4.1 Risk level

`kycanalyzer-nuget/eToro.KYCAnalyzerService.Enums/ClientRiskProfile/RiskLevel.cs`. These are the values in `ClientRiskLevelID`, so the ids are **not** 1–5:

| Name | Id | AuthorizedRiskScore |
|---|---|---|
| `Minimal` | 100 | 3 |
| `Low` | 200 | 3 |
| `Medium` | 300 | 6 |
| `MediumHigh` | 400 | 8 |
| `High` | 500 | 10 |

The score column is `RiskLevelToScoreMappings` from the user's own config document, not a constant — read it from the config rather than hardcoding, since it is per-version. The values above are what all five current configs carry (`../tech.md` §4.4). `Minimal` and `Low` collapsing to the same cap of 3 is deliberate, not a transcription error.

The cap means: a user may copy a target whose risk score is **≤** their `AuthorizedRiskScore`.

### 4.2 Block result

`BlockResult`: `Blocked = 1`, `NotBlocked = 2`. Note the ordering — 1 is the bad state. An app that treats non-zero as OK gets this exactly backwards.

### 4.3 Detail level

`SuitabilityCalculationDetailLevel`: `FactorResult = 1`, `ComponentResult = 2`, `QuestionResult = 3`.

### 4.4 Recalculation reason

`kycanalyzer-nuget/…/RecalculationReason.cs`. Worth surfacing in the UI — "why did this last run" is a question users of the app will ask:

```
1 BulkRecalculation   2 RegulationChanged   3 ReachedVerificationLevel2
4 AnswerChanged       5 Manual              7 Ftd
8 CalculateSuitabilityMonitoringCommand     9 BO
10 UpdateCategorizationCommand   11 ProfessionalCategorizationChanged
12 CountryChanged     13 AutoRelease
14 BulkRecalculationOngoingMonitoring       15 AssessmentExpired
```

There is no 6. Don't render a gap as an error.

### 4.5 Question and answer text — gate G4

`QuestionID` and answer ids resolve to names via `kycanalyzer-nuget/eToro.KYCAnalyzerService.Enums/ClientRiskProfile/KycQuestion.cs` and `KycAnswer.cs`. Those give you **code identifiers**, not user-facing text — `MiCARiskLosingInvestments`, not the sentence the customer actually read.

Three sources, and the choice matters:

| Source | Gives | Tradeoff |
|---|---|---|
| `KycQuestion` / `KycAnswer` enums | Code identifiers | Always available, exactly matches stored ids, unreadable to non-engineers |
| `compliance-kycx-staticdata` | POEditor translation keys per question and answer | The real customer-facing text, and localised. Needs a second integration, and the catalogue is UI-flow-scoped so coverage of scoring-only ids is **unverified** |
| `UserApiDB.KYC.Questions` (lake mirror: `main.compliance.bronze_userapidb_kyc_questions`) | Question id → name, plus `MultipleSelection` | Easy, but questions only — no answer text |

Pragmatic route: enums as the guaranteed fallback so nothing ever renders as a bare number, plus static-data text where it exists. **Never** show an id with no label; that is the failure mode the app exists to fix.

One known trap: an answer id can be **offered by the funnel and scored by no configuration**. `InvestmentsDeposits = 46` on question 15 is selected by 28,850 users and appears in none of the five configs, so it silently falls back to `Medium` (`../verification.md` C-48, C-47). Your renderer needs a state for "answered, but this config does not score it" — otherwise a real and consequential config gap looks like a rendering bug.

---

## 5. Regulation ids, and which ones matter

`kycanalyzer-nuget/eToro.KYCAnalyzerService.Enums/Regulation.cs`. Production holds 104 configuration documents across 14 regulations, but **only five run a suitability test at their current version** (`../tech.md` §6.1):

| Regulation | Current version | Suitability |
|---|---|---|
| CySEC | 24 | yes — the **only** one with component 9 (MiCA crypto) |
| FCA | 15 | yes |
| ASIC | 9 | yes |
| ASICGAML | 15 | yes, with a stricter hard block |
| FSRA | 10 | yes |
| MAS | 12 | **no** — scored at v1–v2, removed from v3 onward |
| Offshore, FINRA, FINRAONLY, FinCEN, NFA, NYDFSFINRA, eToroUS | various | no |

Two consequences for the app. A user under a non-scoring regulation has no tree, and that is correct rather than missing data — say so explicitly. And a **MAS** user may hold a historical result from v1 or v2 while their current config scores nothing, so an app that renders the tree and the current config side by side will show a contradiction that is real.

`MAS = 13`, and one legacy document is stored under the id `13-1` rather than `MAS-1` because the enum member did not exist when it was written. It is unreachable through the point-read path (`../tech.md` §6.1). Only relevant if you enumerate configuration documents directly.

---

## 6. Cosmos, if you end up needing it

Account `prod-kycanalyzer`, resource group `prod-kycanalyzer-we`. Two containers matter: `ClientRiskProfileConfiguration` (the formulas, document id `{Regulation}-{Version}`) and `ClientRiskProfile` (per-user documents, `id` = GCID as a string).

Read-only access is the `Cosmos DB Built-in Data Reader` role. Configuration documents contain no customer data; **`ClientRiskProfile` documents are customer PII**, and a grant on the account covers both. Scope the grant to the container if your environment allows it.

Snapshots of the five suitability-bearing configuration documents already sit in `../config-prod/` — check there before requesting access, because for explainer mode they may be all you need.
