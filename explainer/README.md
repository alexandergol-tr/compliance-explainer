# Suitability Explainer — skeleton

Internal, read-only. Given a GCID or CID, shows a user's suitability outcome and the calculation path that produced it.

**Spike, not a product.** Defaults to synthetic examples; no auth and no audit log, so the real-data path must not be exposed to anyone yet. See [Status](#status) for what is deliberately missing and [../app-handoff/HANDOFF.md](../app-handoff/HANDOFF.md) for the design brief this implements.

```bash
npm install
npm run dev        # http://localhost:3000
npm run check      # typecheck + 118 tests
```

## What it does

Renders what the engine stored. It does not recalculate — the scoring lives in `KYCAnalyzer`, which persists its own factor → component → question tree with a risk level on every node, and reimplementing that here would create a second implementation that drifts from the first.

The interesting part is the states it refuses to conflate, and the fact that the five regulations that still score do not score alike. Click through the examples on the home page:

| Example | Shows |
|---|---|
| `1001` | A normal scored user. Numbers come from the `tech.md` §4.6 worked example, so the tree is arithmetically consistent |
| `1002` | Hard blocked, via all four legs of the CySEC block check |
| `1003` | Scored fine but blocked by ongoing monitoring — a different gate. FCA, so no component 9, and the same answers as `1001` land a level higher |
| `1004` | Below verification level 2. **Not assessed**, which is not `Minimal` |
| `1005` | Internal eToro account. Scoring bypassed, tree empty by design |
| `1006` | MAS v12 — the regulation stopped scoring at v3, so having no result is correct |
| `1007` | An older config version whose leaves carry no `Question` field, only `Name` |
| `1008` | No stored profile at all |
| `1009` | An answer the funnel offers and no configuration scores |
| `1010` | A live CySEC v23 tree, shape-for-shape with identifiers stripped: an experienced trader capped at `Low` because Factor A is a `Min` |
| `1011` | ASIC — the six-component Factor B that every regulation except CySEC uses |
| `1012` | ASICGAML — hard blocked by a fifth condition and a wider risk-appetite band that no other regulation has. The same answers block nowhere else |
| `1013` | FSRA — three questions left unanswered, each taking the configured default, which costs the user a whole level. Also answers the one deposit band this app has no amount for, so the monitoring limit cannot be rebuilt |
| `1014` | Blocked by ongoing monitoring against a limit the app **cannot** reproduce, and where its own arithmetic would say the opposite. Why the stored figure wins |

Lookup handles the resolution failures separately too: `/lookup?id=9003&kind=cid` resolves a CID, `424242` is not found, `abc` is not an identifier, and omitting `kind` is refused rather than guessed.

## Identifiers: you must say which kind

**The three identifier spaces almost completely overlap, so a number carries no evidence of which one it came from.** Measured over the 48,867,085 rows of `Customer.CustomerIdentification`: 99.0% of GCIDs are also some *other* person's real CID, and 96.1% are also some other person's demo CID.

`48744807` is the worked example of the hazard. Read three ways it is three different live customers, each with a populated profile:

| Read as | GCID | Country | Risk level | Answers |
|---|---|---|---|---|
| GCID | 48744807 | 74 | `Low` | 12 |
| real CID | 48749227 | 57 | `Medium` | 29 |
| demo CID | 47566111 | 79 | `Medium` | 14 |

So `resolve()` takes a required `IdKind` and there is no "work it out" option. An earlier version had one, and because CID resolution was unimplemented it silently fell through to reading the number as a GCID — which is to say it answered a question about one customer with another customer's compliance data, on ~99% of inputs, with nothing on screen to indicate it. The profile page now also states which reading produced it (`?via=`), because "which number did I type" is the first thing to check when a profile looks like the wrong person.

Demo CIDs are detected but not resolvable. Suitability is decided per customer rather than per trading account, so a demo id can say nothing a real one cannot, and admitting a third readable space would add collision surface for no gain. A demo CID gets its own explanation instead of a bare "not found", and the owning GCID is deliberately not disclosed.

## Data sources

`activeSource()` picks the first configured, preferring the one that can actually explain a score:

| Source | Tree | Answers | Configure with |
|---|---|---|---|
| Cosmos `ClientRiskProfile` | yes | yes | `COSMOS_ACCOUNT`, `COSMOS_READONLY_KEY` |
| KYCAnalyzer REST API | **no** | **no** | `KYCANALYZER_BASE_URL` |
| Examples (synthetic) | yes | yes | default |

Identity is a separate, optional source. Without it GCID lookup still works, because the profile store is keyed by GCID; only CID resolution goes dark, and it says so rather than falling back to a guess.

| | |
|---|---|
| Table | `main.compliance.bronze_userapidb_customer_customeridentification` |
| Configure with | `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, `DATABRICKS_WAREHOUSE_ID` |

That table mirrors UserApiDB `Customer.CustomerIdentification`, the table eToro assigns identifiers into at registration — `GCID`, `CID` and `DemoCID` on one row, one row per human. It is a bronze parquet mirror on a 1440-minute full-override refresh, so it lags by up to a day and carries no history; irrelevant for ids assigned years ago, but a customer who registered this morning will read as "not found". Being parquet rather than the indexed source table, every lookup is a scan, which is why the client caches.

Chosen over the live service path deliberately. KYCAnalyzer resolves CIDs through UserApi `GET /api/v1/users?realCid=`, whose `BasicUserInfo` DTO declares `Gcid` and a `Cid` bound to the JSON property `RealCid` — and no `DemoCid` at all. That route therefore cannot distinguish a demo CID from a nonexistent one, which is precisely the diagnosis this app needs to make. Two alternatives were measured and rejected: `ProfessionalCategorization` in the same Cosmos account is partitioned by `/RealCid` and carries `Gcid`, so it needs no new credential, but it is far too sparse — none of four test users had a document in it. `Analyzer.UserAttribute` and friends co-locate the columns without being an identity authority.

**The REST API cannot explain a score, and this is a contract fact rather than a bug.** `SuitabilityResultDto` has no `SuitabilityCalculationDetails` field and `ClientRiskProfileResultDto` has no `QuestionsAnswers` field — neither name appears on any DTO in `kycanalyzer-nuget`. It is kept as a source because it is the cheapest supported read of the headline result and the right thing to reconcile against, but it declares `capabilities: { tree: false, answers: false }` so the profile page says "this source cannot supply it" instead of implying the user has no calculation.

## Layout

```
src/domain/     pure, no I/O — ids, labels, outcome, tree, coverage. Where the tests are.
src/config/     reads ../config-prod/*.json (the live production configs, verbatim)
src/sources/    ProfileSource: examples, Cosmos, and the API behind one interface
src/components/ renderer
src/app/        routes
scripts/        gen-enums.mjs — C# enums -> TS id maps
```

Five things are load-bearing rather than incidental:

**`domain/outcome.ts` is a discriminated union, not a nullable risk level.** "No risk level" and "risk level `Minimal`" are different facts, and rendering the first as the second tells a compliance reader a user was assessed and placed at the bottom when they were never assessed at all. Separate variants make that unrepresentable. Non-scoring regulations are the common case: a MAS profile has no `Suitability` property at all.

**Both real clients can only read.** `sources/kycanalyzer/read-only-client.ts` exports only `get`, and `sources/cosmos/read-only-client.ts` exports only a query that requires a partition key. `POST` on the profile route forces a recalculation and overwrites stored compliance data; `PATCH` on the configuration route changes the live scoring formula for an entire regulation; neither controller declares `[Authorize]`. So there is no code path that can emit anything but a read — rather than a client that merely doesn't. Requiring the partition key is the same idea applied to Cosmos: it makes the client a lookup that cannot be turned into a customer-data scanner by changing a `WHERE` clause.

**`domain/tree.ts` is built against the measured payload, not the C# types.** Verified across 578 production trees: no node carries a level discriminator, so depth is the mechanism rather than a fallback; question identity is the `KycQuestion` enum *name*, present in `Question` and always equal to `Name`, and absent on 289 of 7,231 leaves where `Name` alone carries it. Warnings are reserved for genuine anomalies — a tree deeper than three levels, a subtype field at the wrong depth, a name matching no enum member. Warning about depth-derived levels would fire on every healthy document and train the reader to ignore the warning strip.

**`domain/coverage.ts` distinguishes "not scored" from "used elsewhere", and returns a list.** An answer absent from the scoring config is a real defect worth flagging; an answer that feeds the hard-block check instead is not. Collapsing the two produced false alarms on `AnnualIncome` and `LiquidAssets`, which are block inputs by design. It returns every role rather than one because those two answers have *two* jobs — hard block and ongoing monitoring — and picking one to display is how the deposit question came to read "not used by suitability" while setting the user's copy ceiling.

**`domain/monitoring.ts` rebuilds the sustainability limit; `domain/ccm.ts` holds the values it needs.** Ongoing monitoring is the one rule not in the configuration document — its three weightings and its band-to-amount table are CCM keys, so they are transcribed by hand and can fall behind production without warning. The reconstruction therefore always states whether it reproduced the stored figure, and the app never substitutes its own arithmetic for it: example `1014` is blocked under the stored limit and comfortably inside the reconstructed one, so an app that trusted itself would report the opposite of what happened. Copy utilisation is not rebuilt at all, because its inputs come from the trading side's `MirrorSummary`, which this app does not read.

## Regenerating the id maps

`src/domain/generated/kyc-enums.ts` is committed so the app builds without the source repo. Regenerate when the enums change:

```bash
npm run gen:enums [path-to-kycanalyzer-nuget]
```

It warns about ids shared by multiple enum members — ten answer ids are aliased, so the id → name direction is genuinely ambiguous and the UI discloses it rather than picking silently.

## Status

Done: tree rendering, outcome states, config loading, answer coverage, kind-explicit id resolution, a read-only Cosmos source, a read-only identity client, 128 tests. Verified end to end against two live production profiles — one CySEC v23 with a full seven-component Factor B, one MAS v12 with no suitability section at all.

Not done, in the order it matters:

- **Auth.** No SSO, no group check. Must land before anyone but the author points this at real data.
- **Audit log.** Every real-user lookup needs a record. Retrofitting means being unable to answer "who looked at this customer" for the period before it existed.
- **A live run of CID resolution.** The identity client is written and unit-tested against real rows, and its SQL is verified against the warehouse, but it has not yet been exercised end to end through the app because that needs a `DATABRICKS_TOKEN`.
- **Show the operation on each node.** The tree renders levels but not *how* a parent combined its children. Factor A is a `Min`, Factor B a `floor(Avg)`, components a `Max` — and those come from the user's own config document, which the app already loads. This is the single biggest remaining gap between "shows the tree" and "explains the score".
- **Answer text.** Labels come from humanised enum identifiers, not the sentences customers actually read. Wiring `compliance-kycx-staticdata` is gate G4.
- **Config coverage.** `../config-prod/` holds 8 of the 106 live configuration documents, so a user on an older or newer version gets a near-miss config and a warning. ASICGAML is already at v17 against a v15 snapshot.
- **History.** `Analyzer.SuitabilityCalculationDetail` is temporal, so "what changed in March" is a query. SQL only.
- **Divergence check.** Last, and the piece most likely to be wrong.
