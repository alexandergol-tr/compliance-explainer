/**
 * Resolving a question or answer to the words the customer actually read.
 *
 * `labels.ts` humanises C# enum identifiers, which is the wording furthest from the customer and
 * in places actively misleading — question 8's `SavingsForHome` renders as "Saving" on screen and
 * scores Medium, while `PurposeInvestments` renders as "Investments/Savings" and scores Low. An
 * explanation built on enum names describes options nobody was shown.
 *
 * So the chain is: customer copy, then the humanised enum name, then a bare id. Every step is
 * tagged with its `LabelSource` so the UI can say which one it fell to instead of presenting a
 * guess as fact.
 *
 * Answers resolve on the (question, answer) pair, never the answer alone: 61 answer ids are
 * reused across questions and 14 of those carry different wording per question.
 */

import { AnswerCopy, AnswerCopySub, CopySnapshot, QuestionCopy } from './generated/kyc-copy';
import { answerLabel, questionLabel, type Label } from './labels';

export { CopySnapshot };

/** True when this text depends on the assumed account currency rather than on stored data. */
export function assumesCurrency(questionId: number | null | undefined): boolean {
  return questionId !== null && questionId !== undefined
    ? CopySnapshot.currencyDependentQuestions.includes(questionId)
    : false;
}

export interface AnswerText extends Label {
  /** The funnel's supporting line, where it shows one. Risk appetite's est. annual range. */
  sub: string | null;
}

/**
 * The customer-facing option text, falling back through the enum name to a bare id.
 *
 * `questionId` is required rather than optional on purpose. It is the difference between
 * resolving the right wording and resolving whichever question happened to be indexed last.
 */
export function answerText(
  questionId: number | null | undefined,
  answerId: number | null | undefined,
): AnswerText {
  const fallback = answerLabel(answerId);

  if (questionId === null || questionId === undefined || answerId === null || answerId === undefined) {
    return { ...fallback, sub: null };
  }

  const key = `${questionId}:${answerId}`;
  const text = AnswerCopy[key];
  if (text === undefined) return { ...fallback, sub: null };

  return {
    text,
    source: 'static-data',
    // Keep the enum identifier even when copy wins. It is what the configuration keys on, so
    // anyone cross-checking a score against the config document needs it.
    identifier: fallback.identifier,
    aliases: fallback.aliases,
    sub: AnswerCopySub[key] ?? null,
  };
}

/** The question as the customer was asked it, falling back to the humanised enum name. */
export function questionText(questionId: number | null | undefined): Label {
  const fallback = questionLabel(questionId);
  if (questionId === null || questionId === undefined) return fallback;

  const text = QuestionCopy[questionId];
  if (text === undefined) return fallback;

  return { text, source: 'static-data', identifier: fallback.identifier };
}

/**
 * Whether the funnel still offers an answer that a configuration still scores.
 *
 * A statement retired from the funnel but left in the configuration is not inert. Weighted
 * scoring credits *unselected* statements with the negative of their score, so a retired
 * statement contributes to every user's total forever, and nobody can ever select it. Component
 * 8's `NewerCfdTrs` (id 212, the OTC complex products statement) is in exactly this state.
 */
export function isOfferedToCustomers(
  questionId: number | null | undefined,
  answerId: number | null | undefined,
): boolean {
  if (questionId === null || questionId === undefined || answerId === null || answerId === undefined) {
    return false;
  }
  return AnswerCopy[`${questionId}:${answerId}`] !== undefined;
}
