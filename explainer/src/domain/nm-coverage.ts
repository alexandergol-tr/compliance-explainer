/**
 * Which answers feed Negative Market on this configuration.
 *
 * Same id-based matching as suitability coverage — see domain/coverage.ts.
 */

import type { BlockCheck, LoadedConfig } from '@/config/types';
import { KycQuestionIds } from './generated/kyc-enums';
import type { Coverage, CoverageIndex } from './coverage';

function collectQuestionIds(checks: BlockCheck[] | null, out: Set<number>) {
  for (const check of checks ?? []) {
    for (const qac of check.QuestionAnswerChecks ?? []) {
      const id = KycQuestionIds[qac.Question];
      if (id !== undefined) out.add(id);
    }
    if (check.NestedChecks?.length) collectQuestionIds(check.NestedChecks, out);
  }
}

export function buildNmCoverageIndex(config: LoadedConfig | null): CoverageIndex {
  if (!config) {
    return { classify: () => ['unknown'], defaultRiskLevel: null };
  }

  const nmQuestions = new Set<number>();
  for (const product of config.negativeMarketProducts) {
    for (const rule of product.config.Rules ?? []) {
      collectQuestionIds(rule.Checks, nmQuestions);
    }
  }

  return {
    defaultRiskLevel: null,
    classify(questionId, answerId) {
      if (questionId === null || answerId === null) return ['unknown'];
      if (nmQuestions.has(questionId)) return ['scored'];
      return ['not-used'];
    },
  };
}

export function nmCoverageLabel(roles: Coverage[]): string {
  if (roles.includes('scored')) return 'Used by Negative Market';
  if (roles.includes('not-used')) return 'Not used by Negative Market';
  if (roles.includes('unknown')) return 'Unknown to this configuration';
  return roles.join(' · ');
}
