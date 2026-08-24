# Handoff — Suitability Explainer (internal app)

**Audience: the agent picking up the build.** You are expected to have no access to the conversation that produced this pack. Everything load-bearing is written down here or in the two sibling documents. Where something is unverified, it says so — treat those as gates, not as details.

Read this file top to bottom once before writing code. Sections 3 and 4 will change your architecture; discovering them late is expensive.

---

## 1. Mission

Build a read-only internal web app. An eToro employee enters a **GCID or a CID**; the app shows that user's suitability outcome — risk level, authorised risk score, hard-block state, ongoing-monitoring state — and, below it, **the calculation path that produced it**: which factor, which component, which question, and what each contributed.

The point is explanation, not calculation. Today the only way to answer "why is this user capped at 6?" is for an engineer to read a Cosmos document by hand. This app replaces that.

Non-goals, explicitly:

- Not a what-if simulator. That already exists as a spreadsheet — see [MANIFEST.md](MANIFEST.md) §2.
- Not a remediation tool. It must not change a user's answers, risk level, or block state. See §4 on why this is a hard rule and not a preference.
- Not a bulk reporting surface. One user at a time, by deliberate lookup.

---

## 2. The one thing that determines the whole design

**The engine already persists its own calculation tree. Do not reimplement the formula.**

`KYCAnalyzer` writes, per user, a tree of nodes — factor → component → question — with a `ClientRiskLevel` stamped on every node. That structure exists in two places (a Cosmos document and a set of relational rows) and is described field-by-field in [DATA-CONTRACT.md](DATA-CONTRACT.md).

So the app is a reader and a renderer. If you find yourself porting scoring tables into application code, you have taken a wrong turn: you will have built a second implementation that drifts from the first, and every disagreement between them will be blamed on the engine. The scoring tables are documented (`../tech.md` §4.3) and modelled in the workbook, and both exist so that a **human** can check the engine — not so an app can duplicate it.

There is one narrow exception, in phase 4 of §6, and it is opt-in and clearly labelled as a diagnostic.

---

## 3. Decisions already taken

These came from the product owner. Don't relitigate them; do read the consequences, which are not obvious.

### 3.1 Audience: any eToro employee, via SSO

**Consequence you must handle.** The data behind this app is a user's income band, source of wealth, net worth, trading experience and invested amounts. That is sensitive personal data under GDPR and it is exactly the category that draws regulatory attention when access is broad. "Any employee with SSO" and "financial PII" do not sit comfortably together, and the recommendation on record — which the owner has seen — is to split the app rather than the difference:

| Mode | Data | Access | Ships |
|---|---|---|---|
| **Explainer** | Configuration only, plus synthetic or hand-entered answers | Any employee with SSO | First. No PII, so no gate beyond SSO |
| **Lookup** | A real user's stored answers and tree | Named AD group, every lookup audit-logged | Second, behind the group check |

Both modes share one renderer. Explainer mode is genuinely useful on its own — it answers "how does this work" for support and compliance, which is most of the demand — and it lets you get the hard part (tree rendering) right against data that cannot hurt anyone.

If you ship a single mode open to all employees, get that decision in writing from someone who owns the risk, and log every lookup regardless. **Do not** treat the audit log as a phase-2 nicety; retrofitting it means you cannot answer "who looked at this customer" for the period before it existed.

### 3.2 Both GCID and CID accepted from day one

**Consequence.** Everything in `KYCAnalyzer` is keyed by **GCID**. CID is an input format you must resolve before you can do anything, via `UserAPIProvider.GetBasicInfoByCidAsync` (`KYCAnalyzer/eToro.KYCAnalyzerService.Infrastructure/Providers/UserAPIProvider.cs`), which returns `BasicUserInfo { Gcid, Cid, Username }`.

Note what that DTO does: `Cid` is deserialised from the JSON property **`RealCid`**. So the resolution path is real-CID-only. A demo CID will not resolve, and the failure will look like "user not found" rather than "wrong kind of id". Distinguish those two cases in the UI or you will field the same confused bug report repeatedly.

Also: the same number can be a valid GCID and a valid CID for two different people. Never guess based on magnitude. Either make the user pick the id type, or resolve both and show a disambiguation step when both hit. Silently picking one is how the wrong customer's financial data ends up on screen.

### 3.3 The stored engine result is truth; divergence is a warning

**Consequence.** The app never overrides what the engine stored. If a recomputation disagrees, the app says "these disagree, here is where" — it does not say "the correct answer is X".

Getting this comparison right is harder than it looks, and it is the last thing you should build. See §6 phase 4.

---

## 4. Guardrails

Each of these is a way to cause real damage. They are not style preferences.

### 4.1 Both endpoints you need have destructive verbs on the same path

Read and write are one verb apart on both controllers this app touches, and the write side is worse on the configuration controller than on the per-user one.

| Route | Safe | Destructive on the same path |
|---|---|---|
| `api/v1/kycanalyzer/clientRiskProfile/{gcid}` | `GET` — read the profile | **`POST`** — forces a recalculation, overwriting the stored profile and writing a new row to a system-versioned table |
| `api/v1/kycanalyzer/ClientRiskProfileConfiguration/{regulation}` | `GET` — read configs | **`POST`** — adds a configuration version. **`PATCH {regulation}/{formulaConfigurationType}`** — patches the live suitability formula |

`[code]` `KYCAnalyzer/eToro.KYCAnalyzer/Controllers/ClientRiskProfileController.cs` and `ClientRiskProfileConfigurationController.cs`.

Read that second row carefully: a `PATCH` with `formulaConfigurationType = Suitability` **changes the scoring formula for an entire regulation**, which re-scores every user under it. An explainer app has no business being able to construct that request.

Neither controller carries an `[Authorize]` attribute; access is enforced upstream, at the gateway or network boundary. So your app, once it holds a route to this service, is a channel to unauthenticated write endpoints — and its own SSO layer is the only thing standing in front of them.

Build the client so the mistake is structurally impossible rather than merely avoided: a wrapper exposing only GET methods, with no code path that can emit POST or PATCH. "We just don't call it" fails the first time a retry helper, a health probe, or a generated client fills in the gap.

### 4.2 You cannot test this on your own account

When the user's country is `Country.eToro` and the CCM flag `FeatureFlagAlwaysAllowCopyForEtorians` is on, `SuitabilityCalculator.CalculateAsync` returns a hardcoded result — `ClientRiskLevel = High`, `SuitabilityBlock = NotBlocked`, `IsAllQuestionsAnswered = true` — with the formulas skipped entirely, and monitoring short-circuits to `ManuallyUnblocked = true` (`../tech.md` §4.5).

An app built for eTorians, tested by eTorians on eToro accounts, will therefore show a plausible-looking `High` for every internal tester and prove nothing. Worse, it will show an **empty tree**, because no nodes were produced. Detect this case and label it explicitly — "internal account, scoring bypassed" — rather than rendering an empty tree as though it were a data problem.

### 4.3 Absent is not Minimal

Below verification level 2 the calculator returns before producing any `Suitability` object (`../tech.md` §4.5). There is no risk level and no block — not a lowest-band result, an absent one.

Rendering that as `Minimal`, or as a score of 3, is a factual error with consequences: it implies the user has been assessed and placed at the bottom, when in fact they have not been assessed. Use a distinct state.

### 4.4 Treat node names as display text, not identifiers

The `Name` on each tree node is a string supplied by the Cosmos configuration document. It is not a stable key, it is not versioned independently, and it can change when compliance edits a config. Key your rendering logic on `QuestionID` and the level discriminator; use `Name` only for what it is — a label.

### 4.5 Answer ids are masked in one of the four stores

In `UserApiDB`, `KYC.CustomerAnswers.AnswerId` is declared `MASKED WITH (FUNCTION = 'default()')`. A query can therefore succeed and return meaningless answer ids, depending on the permissions of the principal you connect as. This does not fail loudly. Verify against a user whose answers you know before trusting anything read through that path (`../tech.md` §6.4).

---

## 5. Gates

Four unknowns when this brief was written. **G1 is now closed, and the answer removes the preferred option**, so read it before anything else in this section.

### G1. Does the API response contain the tree? — **CLOSED: no, and it never did**

**Answer.** `GET /api/v1/kycanalyzer/clientRiskProfile/{gcid}` returns neither the calculation tree nor the user's answers. The fields are not in the contract:

- `SuitabilityResultDto` declares `SuitabilityBlock`, `ClientRiskLevel`, `RevolvingDoorQuestions`, `OngoingMonitoring`, `IsAllQuestionsAnswered` — and no `SuitabilityCalculationDetails`.
- `ClientRiskProfileResultDto` declares no `QuestionsAnswers` and no `LastAnswerOccurredAt`.
- Neither name appears on any DTO anywhere in `kycanalyzer-nuget`.

`[code]` `kycanalyzer-nuget/eToro.KYCAnalyzerService.Dto/ClientRiskProfile/Result/`.

**How the original framing was wrong, and why it matters.** This section previously described a suspected AutoMapper problem: subtypes not declared with `.Include<>()`, tree flattened to the base shape, `Question` dropped. The mapping profile does indeed lack subtype includes — but that is moot, because the destination type has no field to map the tree *into*. Diagnosing this as a serialisation bug leads to a small upstream DTO PR that would not be small: exposing the tree means adding node DTOs, a polymorphic mapping and a contract change on a shared package, reviewed by the owning team. Treat it as a product decision, not a fix.

**Consequences, in order of impact:**

1. **The API cannot be this app's data source.** Option 1 in G3 is gone for the tree and the answers. It is still the cheapest supported way to read the *headline* result, and the right thing to reconcile against, so keep it — but behind a capability flag, so a missing tree is reported as "this source cannot supply it" rather than "this user has no calculation".
2. **Cosmos or SQL, and Cosmos is the better default.** Cosmos holds the tree *and* the answers *and* `Regulation` + `ConfigurationVersion` in one document, keyed by `/id` = GCID, so a profile read is a single point query — no polymorphic deserialisation problem in practice, because the stored JSON is plain nested objects (see below). SQL gives history but cannot attribute a tree to a config version (C-52).
3. **The stored shape differs from what the C# types suggest** in three ways that will bite a reader written from the types alone. Full detail in tech.md §6.4; the short version: enums serialise as **names** except in `QuestionsAnswers` which is numeric; **no node carries a level discriminator**, so depth is the only signal and the tree is always exactly three deep; question identity is the enum **name** in `Question`, absent on 289 of 7,231 leaves where `Name` alone carries it.
4. **There is no CID anywhere in the profile store.** CID → GCID needs an identity source: the User API's `GetBasicInfoByCidAsync`, or `main.dwh.gold_sql_dp_prod_we_dwh_dbo_dim_customer_masked` (`RealCID` → `GCID`) in the lake.

The working skeleton in [../explainer/](../explainer/README.md) already implements all of this — a read-only Cosmos client that can only issue single-partition document queries, the capability flag, and a tree normaliser built against the measured shape.

### G2. Are the relational tree rows populated in production?

`Analyzer.SuitabilityCalculationDetail` exists in the schema and the write path is implemented — that much is read from code. Whether production rows are present, complete and current is **unverified**. A one-row-count query settles it. See [DATA-CONTRACT.md](DATA-CONTRACT.md) §3 for the query, including the self-join that rebuilds the hierarchy.

Lower priority now that G1 has closed: Cosmos covers the read path, so SQL only matters if you need history.

### G2. Are the relational tree rows populated in production?

`Analyzer.SuitabilityCalculationDetail` exists in the schema and the write path is implemented — that much is read from code. Whether production rows are present, complete and current is **unverified**. A one-row-count query settles it. See [DATA-CONTRACT.md](DATA-CONTRACT.md) §3 for the query, including the self-join that rebuilds the hierarchy.

### G3. Which access path can you actually be granted?

Your environment decides this, and it may not be the technically nicest option. **G1 has reordered these** — the API is no longer a candidate for the tree or the answers:

1. **Cosmos, read-only.** Now the default. The only store with the tree, the answers and `Regulation` + `ConfigurationVersion` together. Either the `Cosmos DB Built-in Data Reader` RBAC role or the account's `primaryReadonlyMasterKey`. The feared polymorphic deserialisation is not a problem in practice: the stored JSON is plain nested objects with a `Childs` array, and levels come from depth.
2. **KycAnalyzer SQL, read-only.** The only path with **history**, since both suitability tables are system-versioned. Cannot attribute a tree to a config version on its own (C-52).
3. **Service API.** Still worth having for the headline result and for reconciliation, but it cannot answer "how was this calculated". Do not plan around it.

Establish which of these you can have **before** designing, and record the answer in this file.

### G4. Where does answer display text come from?

The stored data gives you numeric ids: `QuestionAnswers` is a bare record of `(int QuestionId, IReadOnlyList<int> AnswerIds)` (`KYCAnalyzer/eToro.KYCAnalyzerService.Domain/ClientRiskProfile/Models/QuestionsAnswers/QuestionAnswers.cs`). No text, no timestamp.

An app whose whole purpose is explanation cannot show `Question 15 → Answer 46`. You need id → human text, and there are three sources with different tradeoffs, described in [DATA-CONTRACT.md](DATA-CONTRACT.md) §4. Pick one deliberately: the mapping is the difference between an explainer and a hex dump.

---

## 6. Build order

Sequenced so that the riskiest unknowns are hit first and each phase is independently useful.

**Phase 0 — resolve G3.** G1 is closed (§5): the API cannot supply the tree or the answers, so the only open question is which of Cosmos or SQL you can be granted. Output is a written answer in this file. No application code.

**Phase 1 — explainer mode.** Read the active configuration, render the factor/component/question structure, let the user enter answers by hand and show what each contributes. No PII, no lookup, no auth beyond SSO. Ships fast, absorbs most of the demand, and forces you to get the tree renderer right against data that cannot hurt anyone. *Done when* a compliance reader can follow a worked example end to end without asking an engineer.

**Phase 2 — lookup mode.** Add id resolution (§3.2), the AD-group check and the audit log, and render the **stored** tree through the phase-1 renderer. *Done when* three known users — one blocked, one scored mid-band, one below verification level 2 — render correctly, including the absent-not-Minimal case from §4.3 and the internal-account case from §4.2.

**Phase 3 — history.** Only if the tables from G2 are populated. Both suitability tables are temporal, so "what was this user's risk level in March and what changed" is a query, not an archaeology project. This is often the single most valuable feature for support, and it is unavailable through the API — SQL only.

**Phase 4 — divergence check.** Last, because it is the piece most likely to be wrong, and the app is valuable without it. Three rules make it honest rather than noisy:

- **Only compare when the inputs have not moved.** Compare only if `LastAnswerOccurredAt` predates the scoring run. Otherwise the engine scored a different set of answers than the one you are reading, and a disagreement means nothing.
- **Recompute against the config that ran.** Use the profile's own `ConfigurationVersion`, not the current one. Configs change; comparing a 2024 result against a 2026 config manufactures divergence.
- **Expect it to cluster on component 7.** Production validation reproduced the engine for 99.96% of CySEC users, and the residue sat in component 7 — the same component as a known config gap where an offered answer is scored by no config and falls back to `Medium` (`../verification.md` C-45, C-47, C-48). If your flag fires anywhere else at volume, **suspect your recomputation before suspecting the engine.**

---

## 7. Acceptance criteria

Testable, and derived from the failure modes above rather than from a feature list.

1. A GCID lookup and a CID lookup for the same user produce the same page.
2. A demo CID produces "this looks like a demo account, which cannot be resolved" — not "user not found".
3. An ambiguous id that resolves as both a GCID and a CID produces a disambiguation step, never a silent pick.
4. A user below verification level 2 renders as *not assessed*, distinct from `Minimal`.
5. An internal eToro account renders as *scoring bypassed*, not as an empty tree.
6. The rendered authorised risk score matches the `RiskLevelToScoreMappings` in the user's own config version, with `Minimal` and `Low` both mapping to 3 (`../tech.md` §4.4).
7. The HTTP client is incapable of issuing a POST to the profile route — verified by inspection, not by a test that asserts it doesn't.
8. Every real-user lookup writes an audit record containing who, which id, and when.
9. No endpoint accepts a list of ids or returns more than one user's data.
10. For at least three users whose trees were checked by hand, every node's risk level matches the store.

---

## 8. What's in this pack

| File | Purpose |
|---|---|
| `HANDOFF.md` | This file. Mission, decisions, guardrails, gates, build order |
| [DATA-CONTRACT.md](DATA-CONTRACT.md) | Every data source with exact shapes, id maps, the tree-reconstruction query, and citations to the source repos |
| [MANIFEST.md](MANIFEST.md) | What must travel with this pack, and how to verify on arrival that it did |
| [../explainer/](../explainer/README.md) | **A working skeleton of phases 1–2**, added after this brief was written and since verified against live production data. Next.js + TypeScript, 42 tests. It implements the outcome union from §4.3, a read-only Cosmos client that can only issue single-partition document queries, the source capability flag that G1 made necessary, and a tree normaliser built against the measured stored shape. Read it before rebuilding any of that |

Background, if you need to go deeper than the contract: `../tech.md` is the formula reference (§4.3 is every answer-to-level mapping, §6.4 is where user data lives), `../verification.md` grades every claim by confidence and is the place to check before trusting anything, and `../prod-validation.md` records what was confirmed against production data.

**Read `../verification.md` §4 (Gaps) before you rely on any claim in this pack.** It is the honest list of what was never confirmed.
