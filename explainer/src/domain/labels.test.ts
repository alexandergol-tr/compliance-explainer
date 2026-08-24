import { describe, expect, it } from 'vitest';
import { answerLabel, humanise, questionLabel } from './labels';

describe('humanise', () => {
  it('keeps acronyms together', () => {
    expect(humanise('MiCARiskLosingInvestments')).toBe('MiCA risk losing investments');
    expect(humanise('MiCACryptoAssessmentPrivateKey')).toBe('MiCA crypto assessment private key');
  });

  it('does not split money bands into a stray magnitude letter', () => {
    // The naive version produced "Between200 K And500 K", which reads as a rendering bug.
    expect(humanise('Between200KAnd500K')).toBe('Between 200K and 500K');
    expect(humanise('UpTo10K')).toBe('Up to 10K');
    expect(humanise('Above2000')).toBe('Above 2000');
  });

  it('splits ordinary PascalCase', () => {
    expect(humanise('AdditionalRevenues')).toBe('Additional revenues');
    expect(humanise('FewWeeksUpToSeveralMonth')).toBe('Few weeks up to several month');
  });

  it('handles the signed percentage bands', () => {
    expect(humanise('Plus20ToMinus12Percent')).toBe('Plus 20 to minus 12 percent');
  });
});

describe('label resolution', () => {
  it('never returns a bare number for a known id', () => {
    // 15 = IncomeSource, 46 = InvestmentsDeposits (the unscored answer from C-48).
    expect(questionLabel(15)).toMatchObject({ source: 'enum', identifier: 'IncomeSource' });
    expect(answerLabel(46)).toMatchObject({ source: 'enum', identifier: 'InvestmentsDeposits' });
  });

  it('falls back readably for an unknown id rather than throwing', () => {
    expect(questionLabel(999_999)).toEqual({ text: 'Question 999999', source: 'fallback' });
    expect(answerLabel(999_999)).toEqual({ text: 'Answer 999999', source: 'fallback' });
  });

  it('discloses aliased answer ids instead of silently picking one', () => {
    // 713 is shared by LeverageAmplifiesGainsAndLosses and CfdAssessmentLeverageAmplifies.
    const label = answerLabel(713);
    expect(label.aliases).toBeDefined();
    expect(label.aliases!.length).toBeGreaterThan(1);
  });

  it('leaves non-aliased ids without an alias list', () => {
    expect(answerLabel(46).aliases).toBeUndefined();
  });
});
