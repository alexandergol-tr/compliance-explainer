/**
 * Whether the user's configuration actually uses each answer they gave.
 *
 * This exists to surface a real defect: the copy funnel and the scoring configuration are
 * maintained in different repos and are allowed to drift, so the funnel can offer an answer that
 * no configuration scores. When that happens the engine falls back to the config's
 * `DefaultRiskLevel` and raises nothing anywhere (verification.md C-37, C-47, C-48). Naming it
 * on screen is most of this app's value on that front.
 *
 * The distinction below matters because a first attempt at this flagged every answer missing
 * from the factor tree, which meant `AnnualIncome` and `LiquidAssets` came out as config gaps.
 * They are not — they feed the hard block, which is a different part of the same document. A
 * flag that cries wolf on legitimate inputs is worse than no flag, because the real gaps stop
 * standing out.
 *
 * ## Everything is matched on numeric ids, never on enum names
 *
 * Ten answer ids are aliased in the C# enum, and for some the *first-declared* name is an obsolete
 * one: id 143 is both `IfThePriceOfGoogleStockOnNasdaqGoesUpThePriceOfYourCfdInGoogleWillGoDownNew`
 * (obsolete, declared first) and `NewerCfd` (what the configuration actually lists). Resolving an
 * id to a name and comparing names therefore picks the obsolete spelling and finds no match, which
 * reported every Component 8 statement as an unscored config gap. Ids are unambiguous in both
 * directions, so the configuration's names are converted to ids once, here.
 */

import type { LoadedConfig } from '@/config/types';
import { FSUST_QUESTIONS } from './ccm';
import { KycAnswerIds, KycQuestionIds } from './generated/kyc-enums';

export type Coverage =
  /** Question is scored and this answer has a risk level. */
  | 'scored'
  /** Question is scored but this answer is not listed — the funnel/config drift. */
  | 'unscored-answer'
  /** Not part of risk-level scoring; feeds the hard block. */
  | 'block-input'
  /** Not part of risk-level scoring; feeds the ongoing-monitoring gate. */
  | 'monitoring-input'
  /** Not referenced by suitability at all. */
  | 'not-used'
  /** No configuration loaded, so nothing can be said. */
  | 'unknown';

/**
 * The three questions behind financial sustainability, which is the second half of why this
 * returns a list rather than one verdict.
 *
 * They are not in the configuration document — they are read straight out of the answers by
 * `FinancialSustainabilityCalculator` — so a document-only view of coverage puts the deposit
 * question under "not used by suitability" while it is quietly deciding whether the user can copy
 * at all. Income and liquid assets have two jobs at once, which is the first half of the reason:
 * they feed the hard block *and* sustainability, and a single-verdict column has to drop one.
 */
const MONITORING_QUESTIONS: ReadonlySet<number> = new Set(Object.values(FSUST_QUESTIONS));

export interface CoverageIndex {
  /** Every role this answer plays, most significant first. Never empty. */
  classify(questionId: number | null, answerId: number | null): Coverage[];
  readonly defaultRiskLevel: string | null;
}

export function buildCoverageIndex(config: LoadedConfig | null): CoverageIndex {
  if (!config) {
    return { classify: () => ['unknown'], defaultRiskLevel: null };
  }

  const scoredByQuestion = new Map<number, Set<number>>();
  for (const factor of config.factors) {
    for (const component of factor.Components ?? []) {
      for (const question of component.QuestionAnswers ?? []) {
        const questionId = KycQuestionIds[question.Question];
        if (questionId === undefined) continue;

        const answers = scoredByQuestion.get(questionId) ?? new Set<number>();
        const add = (name: string) => {
          const id = KycAnswerIds[name];
          if (id !== undefined) answers.add(id);
        };
        for (const answer of question.Answers ?? []) add(answer.Answer);
        // Component 8's weighted quiz keeps its statements in a separate, misspelled field, and
        // that field is a list of *groups* rather than of answers. Reading it as a flat list
        // silently added `undefined` and left every current Component 8 statement out of the
        // scored set, so anyone who took the current knowledge assessment had all six flagged
        // as a config gap — the exact false positive this module exists to avoid.
        for (const group of question.WeigthAnswers ?? []) {
          for (const statement of group.Answers ?? []) add(statement.Answer);
        }
        scoredByQuestion.set(questionId, answers);
      }
    }
  }

  const blockQuestions = new Set<number>();
  const collect = (checks: LoadedConfig['blockChecks']) => {
    for (const check of checks) {
      for (const qac of check.QuestionAnswerChecks ?? []) {
        const id = KycQuestionIds[qac.Question];
        if (id !== undefined) blockQuestions.add(id);
      }
      if (check.NestedChecks?.length) collect(check.NestedChecks);
    }
  };
  collect(config.blockChecks);

  return {
    defaultRiskLevel: config.defaultRiskLevel,
    classify(questionId, answerId) {
      if (questionId === null || answerId === null) return ['unknown'];

      const roles: Coverage[] = [];
      const answers = scoredByQuestion.get(questionId);
      if (answers) roles.push(answers.has(answerId) ? 'scored' : 'unscored-answer');
      if (blockQuestions.has(questionId)) roles.push('block-input');
      if (MONITORING_QUESTIONS.has(questionId)) roles.push('monitoring-input');

      return roles.length > 0 ? roles : ['not-used'];
    },
  };
}
