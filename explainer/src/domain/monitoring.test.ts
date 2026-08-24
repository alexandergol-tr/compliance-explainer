import { describe, expect, it } from 'vitest';
import { KycAnswerIds, KycQuestionIds } from './generated/kyc-enums';
import { explainMonitoring, yearsSinceFtd } from './monitoring';
import { deriveMonitoring, type MonitoringState } from './outcome';
import { FixtureSource } from '@/sources/fixtures';
import type { RawProfile } from '@/sources/types';

const q = (name: keyof typeof KycQuestionIds) => KycQuestionIds[name];
const a = (name: keyof typeof KycAnswerIds) => KycAnswerIds[name];

const WITHIN: MonitoringState = { kind: 'within-limit', financialSustainability: 0, copyUtilization: 0 };

/**
 * Income $10K–$50K (30,000) and liquid assets $200K–$500K (350,000) give a balance sheet of
 * 0.5 × 30,000 + 0.5 × 350,000 = 190,000. A plan of $5K–$20K (12,500) over seven years gives an
 * intent of 0.5 × 12,500 × 7 = 43,750, so intent binds. Both totals are used by name below.
 */
const BALANCE_SHEET = 190_000;
const INTENT = 43_750;

function profile(overrides: {
  income?: keyof typeof KycAnswerIds | null;
  liquid?: keyof typeof KycAnswerIds | null;
  plan?: keyof typeof KycAnswerIds | null;
  ftdDate?: string | null;
  fsust?: number | null;
  cu?: number | null;
  manuallyUnblocked?: boolean | null;
  updatedOn?: string | null;
} = {}): RawProfile {
  const {
    income = 'Between10KAnd50K',
    liquid = 'Between200KAnd500K',
    plan = 'Between5KAnd20K',
    ftdDate = '2020-03-11T00:00:00Z',
    fsust = INTENT,
    cu = 10_000,
    manuallyUnblocked = false,
    updatedOn = '2026-08-05T00:00:00Z',
  } = overrides;

  const answers = [
    income && { questionId: q('AnnualIncome'), answerIds: [a(income)] },
    liquid && { questionId: q('LiquidAssets'), answerIds: [a(liquid)] },
    plan && { questionId: q('InvestmentPlan'), answerIds: [a(plan)] },
  ].filter((entry): entry is { questionId: number; answerIds: number[] } => Boolean(entry));

  return {
    gcid: 1,
    updatedOn,
    questionsAnswers: answers,
    suitability: {
      ongoingMonitoring: {
        ftdDate,
        financialSustainability: fsust,
        copyUtilization: cu,
        manuallyUnblocked,
      },
    },
  };
}

const explain = (p: RawProfile, verdict: MonitoringState = WITHIN) =>
  explainMonitoring(p, verdict, new Date('2026-08-16T00:00:00Z'));

describe('explainMonitoring', () => {
  it('returns nothing when the profile carries no monitoring section', () => {
    expect(explain({ gcid: 1, suitability: {} })).toBeNull();
    expect(explainMonitoring(null, WITHIN)).toBeNull();
  });

  it('reproduces a stored figure and names the binding path', () => {
    const result = explain(profile())!;

    expect(result.paths.map((p) => p.total)).toEqual([BALANCE_SHEET, INTENT]);
    expect(result.computed).toBe(INTENT);
    expect(result.binding).toBe('intent');
    expect(result.agrees).toBe(true);
  });

  it('lets the balance sheet bind when the declared plan is the larger of the two', () => {
    const result = explain(
      profile({ plan: 'AnswerBetween50KAnd200K', fsust: BALANCE_SHEET }),
    )!;

    // 0.5 x 125,000 x 7 = 437,500, well above the 190,000 the balance sheet allows.
    expect(result.paths[1].total).toBe(437_500);
    expect(result.binding).toBe('balance-sheet');
    expect(result.computed).toBe(BALANCE_SHEET);
    expect(result.agrees).toBe(true);
  });

  it('shows each term with the band the customer read and the CCM weight key', () => {
    const [balanceSheet] = explain(profile())!.paths;

    expect(balanceSheet.terms[0]).toMatchObject({
      questionId: q('AnnualIncome'),
      answerId: a('Between10KAnd50K'),
      amount: 30_000,
      weight: 0.5,
      weightKey: 'IncomeSuitabilityWeighting',
      product: 15_000,
    });
    expect(balanceSheet.terms[0].band).toMatch(/10/);
  });

  it('counts the first deposit year itself', () => {
    // 2020 to 2026 is six elapsed years; the engine's `(now - ftd) + 1` makes it seven.
    expect(yearsSinceFtd('2020-03-11T00:00:00Z', 2026)).toBe(7);
    expect(yearsSinceFtd('2026-12-31T00:00:00Z', 2026)).toBe(1);
    expect(explain(profile())!.paths[1].years).toBe(7);
  });

  it('counts years to the year the result was calculated, not to today', () => {
    // Using today's year would add a year to the multiplier and disagree with a figure the engine
    // produced in 2024 — a disagreement invented entirely by this app.
    const result = explain(profile({ updatedOn: '2024-01-05T00:00:00Z', fsust: 31_250 }))!;

    expect(result.evaluatedIn).toEqual({ year: 2024, source: 'result-updated' });
    expect(result.paths[1].years).toBe(5);
    expect(result.agrees).toBe(true);
    expect(result.notes.join(' ')).toContain('2024');
  });

  it('falls back to the current year and says so when there is no calculation date', () => {
    const result = explain(profile({ updatedOn: null }))!;

    expect(result.evaluatedIn).toEqual({ year: 2026, source: 'today' });
    expect(result.notes.join(' ')).toContain('no calculation date');
  });

  it('cannot compute the intent path without a first deposit date', () => {
    const result = explain(profile({ ftdDate: null, fsust: null }))!;

    expect(result.paths[1].total).toBeNull();
    expect(result.paths[1].blockers.join(' ')).toContain('first deposit date');
    // The engine returns no figure at all in this state, so neither should the Min.
    expect(result.computed).toBeNull();
    expect(result.agrees).toBeNull();
  });

  it('cannot compute a path with an unanswered question, and says which one', () => {
    const result = explain(profile({ liquid: null, fsust: null }))!;

    expect(result.paths[0].total).toBeNull();
    expect(result.paths[0].blockers).toHaveLength(1);
    expect(result.paths[0].blockers[0]).toMatch(/No answer on record/);
    expect(result.computed).toBeNull();
  });

  it('cannot price a band that CCM has no entry for', () => {
    // `UpTo20K` (141) is a current funnel option on the deposit question and is absent from our
    // transcription of the band table. Whether production is also missing it is unknown, which is
    // the point: the reconstruction has to stop rather than guess a midpoint.
    const result = explain(profile({ plan: 'UpTo20K', fsust: null }))!;

    expect(result.paths[1].terms[0].amount).toBeNull();
    expect(result.paths[1].total).toBeNull();
    expect(result.paths[1].blockers[0]).toContain('FSUSTAnswerToExactMoneyAmountMapping');
  });

  it('flags a disagreement and points at the CCM transcriptions', () => {
    const result = explain(profile({ fsust: 60_000 }))!;

    expect(result.computed).toBe(INTENT);
    expect(result.agrees).toBe(false);
    expect(result.notes.join(' ')).toContain('CCM');
  });

  it('notes when the inputs exist but the gate has never been evaluated', () => {
    const result = explain(profile({ fsust: null }))!;

    expect(result.agrees).toBeNull();
    expect(result.notes.join(' ')).toContain('has not been evaluated');
  });

  it('warns when a total leans on the one band amount we are unsure of', () => {
    const result = explain(profile({ liquid: 'Between1MAnd5M', fsust: null }))!;

    expect(result.paths[0].total).toBe(1_515_000);
    expect(result.notes.join(' ')).toContain('300,000');
  });

  it('reports headroom from the stored figures, not the reconstructed ones', () => {
    // What the gate actually compared. Showing our own arithmetic here would report headroom the
    // engine never had.
    expect(explain(profile({ fsust: 50_000, cu: 12_000 }))!.headroom).toBe(38_000);
    expect(explain(profile({ cu: null }))!.headroom).toBeNull();
  });

  it('passes the verdict through untouched', () => {
    const unblocked: MonitoringState = { kind: 'manually-unblocked' };
    expect(explain(profile({ manuallyUnblocked: true }), unblocked)!.verdict).toBe(unblocked);
  });
});

/**
 * Every worked example must reconstruct its own limit, or say in its description why it does not.
 *
 * Without this the examples rot the same way an earlier revision's trees did: a stored figure gets
 * nudged, the reconstruction starts disagreeing, and the app ships a page full of warnings that are
 * true of the fixture and say nothing about the engine. The two exceptions are deliberate and are
 * listed by number so adding a third is a decision rather than an accident.
 *
 * `explainMonitoring` counts years to the profile's own `updatedOn`, so these results do not move
 * as the calendar does.
 */
describe('the worked examples', () => {
  const EXPECTED: Readonly<Record<number, 'agrees' | 'cannot-compute'>> = {
    1001: 'agrees',
    1002: 'agrees',
    1003: 'agrees',
    // No answers at all: an internal account whose scoring is bypassed.
    1005: 'cannot-compute',
    1007: 'agrees',
    1009: 'agrees',
    1010: 'agrees',
    1011: 'agrees',
    1012: 'agrees',
    // Answers the one deposit band this app has no amount for.
    1013: 'cannot-compute',
  };

  it.each(Object.entries(EXPECTED))('%s reconstructs as expected', async (gcid, expectation) => {
    const source = new FixtureSource();
    const raw = await source.getProfile(Number(gcid));
    const result = explainMonitoring(raw, deriveMonitoring(raw!));

    expect(result).not.toBeNull();
    if (expectation === 'agrees') {
      expect(result!.agrees).toBe(true);
    } else {
      expect(result!.computed).toBeNull();
    }
  });

  it('1014 is the one that disagrees, and disagrees the way its comment says', async () => {
    const raw = await new FixtureSource().getProfile(1014);
    const result = explainMonitoring(raw, deriveMonitoring(raw!))!;

    expect(result.agrees).toBe(false);
    expect(result.computed).toBe(237_500);
    expect(result.stored.financialSustainability).toBe(118_750);
    // Blocked on the stored limit, inside the reconstructed one. The disagreement changes the
    // verdict, which is why the app never substitutes its own arithmetic.
    expect(result.verdict.kind).toBe('blocked');
    expect(result.computed! > result.stored.copyUtilization!).toBe(true);
  });

  it('says nothing for the examples with no monitoring data', async () => {
    const source = new FixtureSource();
    for (const gcid of [1004, 1006, 1008]) {
      const raw = await source.getProfile(gcid);
      expect(explainMonitoring(raw, raw ? deriveMonitoring(raw) : WITHIN)).toBeNull();
    }
  });
});
