import { AnswersTableClient, type AnswerRow } from './answers-table-client';
import { answerText, questionText } from '@/domain/copy';
import type { Coverage, CoverageIndex } from '@/domain/coverage';
import type { RawQuestionAnswers } from '@/sources/types';

/**
 * The user's answers, resolved to text, with what the configuration does with each one.
 *
 * The right-hand column is the interesting part — see domain/coverage.ts for why it
 * distinguishes a genuine funnel-versus-config gap from an answer that simply feeds a
 * different part of the document.
 *
 * This is also the one place that carries question and answer ids. Everywhere else reads better
 * without them, and anyone cross-checking a result against a configuration document can find every
 * id they need here in one pass.
 *
 * Rows are built here rather than in the client component because classification needs the loaded
 * configuration, which only exists on the server. The client half only filters.
 */

/**
 * One phrase per role, joined.
 *
 * An answer can have two jobs — income feeds the hard block and financial sustainability at the
 * same time — and picking one of them to display is how the deposit question came to read "not used
 * by suitability" while deciding whether the user could copy at all.
 */
function coverageLabel(roles: Coverage[], defaultRiskLevel: string | null): string {
  const phrases = roles.map((role) => {
    switch (role) {
      case 'scored':
        return 'Scored';
      case 'unscored-answer':
        return `Not scored — falls back to ${defaultRiskLevel ?? 'the config default'}`;
      case 'block-input':
        return 'hard-block input';
      case 'monitoring-input':
        return 'monitoring input';
      case 'not-used':
        return 'Not used by suitability';
      case 'unknown':
        return 'Unknown to this configuration';
    }
  });

  // Nothing in the list scores, so say so once at the front rather than after each role.
  if (!roles.includes('scored') && !roles.includes('unscored-answer') && phrases.length > 0) {
    const scoringless = roles.every((role) => role === 'block-input' || role === 'monitoring-input');
    if (scoringless) phrases.unshift('Not scored');
  }

  return phrases.join(' · ');
}

export function AnswersTable({
  answers,
  coverage,
}: {
  answers: RawQuestionAnswers[];
  coverage: CoverageIndex;
}) {
  if (answers.length === 0) {
    return <p className="text-sm text-muted">No answers are stored for this user.</p>;
  }

  const rows: AnswerRow[] = answers.flatMap((entry) => {
    const q = questionText(entry.questionId);
    return entry.answerIds.map((answerId) => {
      const a = answerText(entry.questionId, answerId);
      // Classified on ids. Resolving an id back to an enum name first would pick the
      // obsolete spelling for the ten aliased ids and report them as unscored.
      const roles = coverage.classify(entry.questionId, answerId);

      return {
        key: `${entry.questionId}-${answerId}`,
        questionId: entry.questionId,
        question: q.text,
        answerId,
        answer: a.text,
        reconstructed: a.source !== 'static-data',
        roles,
        coverageLabel: coverageLabel(roles, coverage.defaultRiskLevel),
      };
    });
  });

  return <AnswersTableClient rows={rows} />;
}
