/**
 * Values the suitability engine reads from CCM rather than from a configuration document.
 *
 * **If a reconstruction in this app disagrees with a stored number, check this file first.**
 * Everything here is a transcription, and CCM can be retuned without a deploy, so drift between
 * these constants and production is the expected cause of a mismatch — not an engine bug.
 *
 * Why they cannot be loaded like the rest: `config-prod/` holds `ClientRiskProfileConfiguration`
 * documents, which carry the scoring factors and the hard block. Ongoing monitoring is not in
 * them. Its weightings and its band-to-amount table are CCM keys read per request
 * (`ConfigurationProvider.cs`), and no dump of the production values exists in any repo we have.
 *
 * Confidence, per `verification.md` C-29: **High** that the structure is right, **Medium** on the
 * values, which come from the service's own unit-test fixtures
 * (`FinancialSustainabilityCalculatorServiceTests.cs`). Gap G-11: nobody has validated ongoing
 * monitoring against production data, so nothing below has been confirmed against a live account.
 */

import { KycAnswerIds, KycQuestionIds } from './generated/kyc-enums';

/** CCM key names, so a mismatch can be chased without grepping the service. */
export const CCM_KEYS = {
  weights: 'FSUSTFormulaFactors',
  bandAmounts: 'FSUSTAnswerToExactMoneyAmountMapping',
} as const;

/**
 * The three weightings, all `0.5` in the service's fixtures.
 *
 * The field names are the CCM ones rather than anything friendlier, because those are what someone
 * comparing this against the live key will be reading.
 */
export const FSUST_WEIGHTS = {
  /** Applied to the planned-investment amount on the intent path. */
  ExpectedFundsToAllocateToCopyTrading: 0.5,
  /** Applied to annual income on the balance-sheet path. */
  IncomeSuitabilityWeighting: 0.5,
  /** Applied to liquid assets on the balance-sheet path. */
  CashAndLiquidAssetsSuitabilityWeighting: 0.5,
} as const;

/**
 * Copy utilisation's own weighting.
 *
 * Unlike the three above this one really is hardcoded, in
 * `CopyUtilizationCalculationService.CalculateCopyUtilization`. Kept here anyway so the two halves
 * of the gate read from one place.
 */
export const CU_CASH_ALLOCATED_WEIGHT = 0.5;

const a = (name: keyof typeof KycAnswerIds): number => {
  const id = KycAnswerIds[name];
  if (id === undefined) throw new Error(`CCM band map references unknown answer "${name}"`);
  return id;
};

/**
 * Band answer to a single amount. Note this is a lookup, not a computed midpoint — the engine
 * indexes straight into the dictionary, and a band with no entry throws `KeyNotFoundException`,
 * which the calculator catches and turns into a null FSUST. So a missing band does not just make
 * one term unknown; it silently switches the whole gate off for that user.
 *
 * One current funnel option has no entry here: `UpTo20K` (141), the lowest band on the deposit
 * question. Every other option the funnel offers on questions 10, 11 and 14 is covered. We cannot
 * tell from the fixture whether production is also missing it, so this app declines to price it
 * rather than inventing a midpoint — but it is the first thing to check if a user who answered
 * "Up to $20K" has no sustainability figure.
 */
export const FSUST_BAND_AMOUNT: Readonly<Record<number, number>> = {
  // Income and liquid assets, current bands
  [a('UpTo10K')]: 5_000,
  [a('Between10KAnd50K')]: 30_000,
  [a('Between50KAnd200K')]: 125_000,
  [a('Between200KTo500K')]: 350_000,
  [a('Between500KTo1M')]: 750_000,
  [a('Between1MAnd5M')]: 3_000_000,
  // Income and liquid assets, older bands still present in the map
  [a('Between200KAnd500K')]: 350_000,
  [a('Between500KAnd1M')]: 750_000,
  [a('Between200KAnd1M')]: 600_000,
  [a('Over1M')]: 1_000_000,
  [a('Above1M')]: 1_000_000,
  // Planned yearly investment
  [a('UpTo1K')]: 500,
  [a('Between1KAnd5K')]: 3_000,
  [a('Between5KAnd20K')]: 12_500,
  [a('AnswerBetween20KAnd50K')]: 35_000,
  [a('AnswerBetween50KAnd200K')]: 125_000,
};

/**
 * Bands whose amount we are not confident in.
 *
 * `Between1MAnd5M` is the only one. The service fixture maps it to `300,000`, which would make the
 * top band worth less than half of the `$500K–$1M` band below it — almost certainly a dropped zero.
 * The client's `answers.data.ts` says `3,000,000`, which restores the ordering, and
 * `verification.md` resolved the conflict in favour of the client table. We use `3,000,000`, but a
 * reconstruction that leans on this band gets a note, because if anything here is wrong it is this.
 */
export const DISPUTED_BAND_AMOUNTS: Readonly<Record<number, string>> = {
  [a('Between1MAnd5M')]:
    'the service fixture says 300,000 and the client table says 3,000,000; we use 3,000,000 because ' +
    '300,000 would price the top band below the one beneath it',
};

/** `KycQuestion` ids of the three questions that feed financial sustainability. */
export const FSUST_QUESTIONS = {
  annualIncome: KycQuestionIds.AnnualIncome,
  liquidAssets: KycQuestionIds.LiquidAssets,
  investmentPlan: KycQuestionIds.InvestmentPlan,
} as const;
