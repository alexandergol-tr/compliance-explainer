/**
 * Rebuilding the ongoing-monitoring gate from this user's own answers.
 *
 * The gate is the one part of suitability that the rest of this app cannot explain. Everything
 * else is derivable: the tree records which answer landed at which node, and the configuration
 * document says what each answer is worth. Monitoring stores two finished numbers —
 * `FinancialSustainability` and `CopyUtilization` — and nothing about how either was reached, so a
 * user blocked by it currently gets a verdict with no reasoning behind it.
 *
 * Half of that is recoverable and half is not, and the difference is worth being blunt about:
 *
 *   - **FSUST is recoverable.** It is a function of three answers we already have plus the first
 *     deposit year, so we can recompute it and check our arithmetic against the stored number.
 *   - **CU is not.** Its inputs are `CashAllocated` and `RealizedProfitAndLoss` from the trading
 *     side's `MirrorSummary` table, which this app does not read. The stored figure is all there is.
 *
 * So this module reconstructs FSUST, states plainly whether the reconstruction agrees, and leaves
 * CU as a stored value. A reconstruction that agrees means the numbers on screen explain the
 * verdict; one that disagrees means something below is stale — most likely the CCM transcriptions
 * in `ccm.ts`, which is the first place to look.
 *
 * ## Why both paths are always shown
 *
 * `FSUST = Min(balance sheet, intent)`. Showing only the winner hides the fact that the other path
 * exists, and the other path is usually the interesting one: a user blocked by monitoring is
 * blocked because *one* of the two came out small, and which one it was determines what would
 * change the answer. So both are computed and rendered, with the binding one marked.
 */

import {
  CCM_KEYS,
  CU_CASH_ALLOCATED_WEIGHT,
  DISPUTED_BAND_AMOUNTS,
  FSUST_BAND_AMOUNT,
  FSUST_QUESTIONS,
  FSUST_WEIGHTS,
} from './ccm';
import { answerText, questionText } from './copy';
import type { MonitoringState } from './outcome';
import type { RawProfile, RawQuestionAnswers } from '@/sources/types';

export type FsustPathKind = 'balance-sheet' | 'intent';

/** One weighted answer inside a path. */
export interface FsustTerm {
  questionId: number;
  question: string;
  answerId: number | null;
  /** The band as the customer read it, e.g. "$10K - $50K". Null when unanswered. */
  band: string | null;
  /** From the CCM band table. Null when unanswered or when the band has no entry. */
  amount: number | null;
  weight: number;
  /** The CCM field the weight came from, so a wrong weight can be traced. */
  weightKey: string;
  product: number | null;
}

export interface FsustPath {
  kind: FsustPathKind;
  /** What this path claims to measure, in words. */
  label: string;
  terms: FsustTerm[];
  /** The years-since-first-deposit multiplier. Only the intent path has one. */
  years: number | null;
  /** The year the multiplier counts from, so the count can be checked rather than taken. */
  ftdYear: number | null;
  total: number | null;
  /** Why this path has no total. Empty when it does. */
  blockers: string[];
}

export interface MonitoringExplanation {
  verdict: MonitoringState;
  stored: {
    financialSustainability: number | null;
    copyUtilization: number | null;
    manuallyUnblocked: boolean | null;
    ftdDate: string | null;
  };
  /** How much room is left before the gate trips: stored FSUST − stored CU. */
  headroom: number | null;
  paths: FsustPath[];
  /** Which path `Min` selected. Null when either total is unknown. */
  binding: FsustPathKind | null;
  /** Our recomputed FSUST. Null when either path could not be computed. */
  computed: number | null;
  /** Whether `computed` matches the stored figure. Null when there is nothing to compare. */
  agrees: boolean | null;
  /**
   * The year standing in for the engine's `DateTime.Now`, and where we got it. The engine evaluates
   * years-since-FTD at calculation time, so today's year is the wrong input for a result stored in
   * a previous year — it would inflate the intent path and manufacture a disagreement.
   */
  evaluatedIn: { year: number; source: 'result-updated' | 'today' } | null;
  /** Things a reader should know before trusting the comparison. */
  notes: string[];
}

const CENT = 0.005;

function amountFor(answerId: number | null): number | null {
  if (answerId === null) return null;
  return FSUST_BAND_AMOUNT[answerId] ?? null;
}

function firstAnswerId(answers: RawQuestionAnswers[], questionId: number): number | null {
  const entry = answers.find((a) => a.questionId === questionId);
  // These are single-select bands. If a record somehow carries several, the engine reads
  // `AnswerIds.First()`, so we do too rather than quietly averaging them.
  return entry?.answerIds?.[0] ?? null;
}

function buildTerm(
  answers: RawQuestionAnswers[],
  questionId: number,
  weightKey: keyof typeof FSUST_WEIGHTS,
): FsustTerm {
  const answerId = firstAnswerId(answers, questionId);
  const amount = amountFor(answerId);
  const weight = FSUST_WEIGHTS[weightKey];

  return {
    questionId,
    question: questionText(questionId).text,
    answerId,
    band: answerId === null ? null : answerText(questionId, answerId).text,
    amount,
    weight,
    weightKey,
    product: amount === null ? null : amount * weight,
  };
}

function blockersFor(terms: FsustTerm[]): string[] {
  const blockers: string[] = [];
  for (const term of terms) {
    if (term.answerId === null) {
      blockers.push(`No answer on record for ${term.question}.`);
    } else if (term.amount === null) {
      blockers.push(
        `${term.band ?? `Answer ${term.answerId}`} has no entry in ${CCM_KEYS.bandAmounts}, ` +
          'so the engine cannot price it either.',
      );
    }
  }
  return blockers;
}

function totalOf(terms: FsustTerm[], years: number | null): number | null {
  if (terms.some((t) => t.product === null)) return null;
  const sum = terms.reduce((acc, t) => acc + (t.product ?? 0), 0);
  return years === null ? sum : sum * years;
}

/**
 * Years since the first deposit, counting the deposit year itself.
 *
 * `(now.Year - ftd.Year) + 1` in the engine — calendar years, not elapsed time, so a deposit made
 * on 31 December counts a full year on 1 January.
 */
export function yearsSinceFtd(ftdDate: string, evaluationYear: number): number | null {
  const ftdYear = firstDepositYear(ftdDate);
  return ftdYear === null ? null : evaluationYear - ftdYear + 1;
}

function firstDepositYear(ftdDate: string | null): number | null {
  if (!ftdDate) return null;
  const year = new Date(ftdDate).getFullYear();
  return Number.isFinite(year) ? year : null;
}

function evaluationYear(
  profile: RawProfile,
  today: Date,
): { year: number; source: 'result-updated' | 'today' } {
  if (profile.updatedOn) {
    const year = new Date(profile.updatedOn).getFullYear();
    if (Number.isFinite(year)) return { year, source: 'result-updated' };
  }
  return { year: today.getFullYear(), source: 'today' };
}

/**
 * Null when the profile carries no monitoring section at all — there is then nothing to explain,
 * as distinct from a gate that ran and passed.
 */
export function explainMonitoring(
  profile: RawProfile | null,
  verdict: MonitoringState,
  today: Date = new Date(),
): MonitoringExplanation | null {
  const monitoring = profile?.suitability?.ongoingMonitoring;
  if (!profile || !monitoring) return null;

  const answers = profile.questionsAnswers ?? [];
  const stored = {
    financialSustainability: monitoring.financialSustainability ?? null,
    copyUtilization: monitoring.copyUtilization ?? null,
    manuallyUnblocked: monitoring.manuallyUnblocked ?? null,
    ftdDate: monitoring.ftdDate ?? null,
  };

  const evaluatedIn = evaluationYear(profile, today);

  const balanceSheetTerms = [
    buildTerm(answers, FSUST_QUESTIONS.annualIncome, 'IncomeSuitabilityWeighting'),
    buildTerm(answers, FSUST_QUESTIONS.liquidAssets, 'CashAndLiquidAssetsSuitabilityWeighting'),
  ];
  const intentTerms = [
    buildTerm(answers, FSUST_QUESTIONS.investmentPlan, 'ExpectedFundsToAllocateToCopyTrading'),
  ];

  const years = stored.ftdDate ? yearsSinceFtd(stored.ftdDate, evaluatedIn.year) : null;
  const intentBlockers = blockersFor(intentTerms);
  if (years === null) {
    intentBlockers.push(
      stored.ftdDate
        ? `The first deposit date "${stored.ftdDate}" could not be read as a date.`
        : 'No first deposit date on the record, so the years multiplier is unknown. The engine ' +
          'returns no sustainability figure at all in this case.',
    );
  }

  const balanceSheet: FsustPath = {
    kind: 'balance-sheet',
    label: 'What they can afford',
    terms: balanceSheetTerms,
    years: null,
    ftdYear: null,
    total: totalOf(balanceSheetTerms, null),
    blockers: blockersFor(balanceSheetTerms),
  };

  const intent: FsustPath = {
    kind: 'intent',
    label: 'What they said they would invest',
    terms: intentTerms,
    years,
    ftdYear: firstDepositYear(stored.ftdDate),
    total: years === null ? null : totalOf(intentTerms, years),
    blockers: intentBlockers,
  };

  const paths = [balanceSheet, intent];
  const computed =
    balanceSheet.total === null || intent.total === null
      ? null
      : Math.min(balanceSheet.total, intent.total);
  const binding =
    computed === null ? null : balanceSheet.total === computed ? 'balance-sheet' : 'intent';

  const agrees =
    computed === null || stored.financialSustainability === null
      ? null
      : Math.abs(computed - stored.financialSustainability) < CENT;

  const notes: string[] = [];

  if (evaluatedIn.source === 'today') {
    notes.push(
      'This profile records no calculation date, so the years multiplier is counted to the current ' +
        'year. If the stored figure was produced earlier, the intent path here will be larger than ' +
        'the one the engine used.',
    );
  } else if (evaluatedIn.year !== today.getFullYear()) {
    notes.push(
      `The years multiplier is counted to ${evaluatedIn.year}, the year this result was calculated, ` +
        'not to the current year — that is the input the engine had.',
    );
  }

  for (const term of paths.flatMap((p) => p.terms)) {
    const dispute = term.answerId === null ? undefined : DISPUTED_BAND_AMOUNTS[term.answerId];
    if (dispute) {
      notes.push(`The amount for ${term.band} is uncertain: ${dispute}.`);
    }
  }

  if (agrees === false) {
    notes.push(
      `Our arithmetic does not reproduce the stored figure, so treat the breakdown as illustrative. ` +
        `The likeliest cause is a stale transcription of ${CCM_KEYS.weights} or ` +
        `${CCM_KEYS.bandAmounts} — both are CCM keys that can be retuned without a deploy, and ` +
        'neither has a production dump to check against.',
    );
  }

  if (computed === null && stored.financialSustainability !== null) {
    notes.push(
      'The engine produced a limit where this reconstruction cannot, so whatever is missing above ' +
        "is missing from this app's inputs rather than from the user's record.",
    );
  }

  if (computed !== null && stored.financialSustainability === null) {
    notes.push(
      'The record has no sustainability figure even though all the inputs for one are present, ' +
        'which means the gate has not been evaluated since these answers were given rather than ' +
        'that it could not be.',
    );
  }

  return {
    verdict,
    stored,
    headroom:
      stored.financialSustainability === null || stored.copyUtilization === null
        ? null
        : stored.financialSustainability - stored.copyUtilization,
    paths,
    binding,
    computed,
    agrees,
    evaluatedIn,
    notes,
  };
}

/** Rendered above the CU figure, since nothing about it can be recomputed here. */
export const CU_EXPRESSION = `${CU_CASH_ALLOCATED_WEIGHT * 100}% × cash allocated to copies − realised P/L on closed copies`;
