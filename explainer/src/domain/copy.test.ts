import { describe, expect, it } from 'vitest';
import { answerText, assumesCurrency, isOfferedToCustomers, questionText } from './copy';

describe('answerText', () => {
  it('prefers the wording the customer read over the enum name', () => {
    const answer = answerText(8, 900);
    expect(answer.text).toBe('Investments/Savings');
    expect(answer.source).toBe('static-data');
    // The identifier survives because the configuration keys on it, not on the text.
    expect(answer.identifier).toBe('PurposeInvestments');
  });

  it('separates two options whose enum names would mislead', () => {
    // `SavingsForHome` sounds specific and scores Medium; the customer just reads "Saving".
    // `PurposeInvestments` scores Low. Explaining either with the enum name describes an option
    // that was never on screen.
    expect(answerText(8, 22).text).toBe('Saving');
    expect(answerText(8, 900).text).toBe('Investments/Savings');
  });

  it('resolves on the question too, because answer ids are reused with different wording', () => {
    // a140 is the same enum member under both questions but the funnel words it differently.
    expect(answerText(47, 140).text).toBe('Above $2000');
    expect(answerText(48, 140).text).toBe('Above $2,000');
  });

  it('carries the supporting line where the funnel shows one', () => {
    const answer = answerText(9, 25);
    expect(answer.text).toBe('Moderate');
    expect(answer.sub).toBe('Est. annual range: -20% to +20%');
  });

  it('falls back to the humanised enum name, and says so', () => {
    // 212 is `NewerCfdTrs`, retired from the funnel, so no copy exists for it.
    const answer = answerText(23, 212);
    expect(answer.source).toBe('enum');
    expect(answer.identifier).toBe('NewerCfdTrs');
  });

  it('falls back rather than guessing when the question is unknown', () => {
    expect(answerText(null, 900).source).not.toBe('static-data');
    expect(answerText(8, null).text).toBe('Unknown answer');
  });
});

describe('questionText', () => {
  it('uses the question as it was asked', () => {
    const question = questionText(8);
    expect(question.text).toBe('What can we help you achieve?');
    expect(question.identifier).toBe('TradingPurpose');
  });

  it('falls back to the enum name for a question the catalogue does not carry', () => {
    const question = questionText(15);
    expect(question.identifier).toBe('IncomeSource');
  });
});

describe('isOfferedToCustomers', () => {
  it('is false for a statement the configuration still scores but the funnel dropped', () => {
    // The whole reason this exists: weighted scoring credits unselected statements, so a retired
    // one contributes to every user's total and nobody can select it.
    expect(isOfferedToCustomers(23, 212)).toBe(false);
    expect(isOfferedToCustomers(23, 142)).toBe(true);
  });
});

describe('assumesCurrency', () => {
  it('marks only the two questions whose copy interpolates a currency we do not have', () => {
    expect(assumesCurrency(10)).toBe(true);
    expect(assumesCurrency(11)).toBe(true);
    expect(assumesCurrency(8)).toBe(false);
    expect(assumesCurrency(null)).toBe(false);
  });
});
