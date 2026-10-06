/**
 * Negative Market outcome — read from the stored profile, explained with config predicates.
 *
 * The engine persists per-product results and per-rule breakdowns. This module does not
 * recompute verdicts; it renders what was stored and cites the configuration that defines each
 * rule.
 */

import type { BlockCheck, LoadedConfig, LoadedNegativeMarketProduct } from '@/config/types';
import { formatAutoRelease } from '@/config/nm';
import {
  answersByQuestion,
  buildCheckNode,
  decisiveLeaves,
  matchedLeaves,
  type AnswersByQuestion,
  type BlockCheckNode,
} from './block-explain';
import { regulationName, recalculationReasonName } from './ids';
import type { Provenance } from './outcome';
import type { RawNmRuleResult, RawProductNegativeMarkets, RawProfile } from '@/sources/types';

export { decisiveLeaves, matchedLeaves };
export type { BlockCheckLeaf as NmCheckLeaf, BlockCheckNode as NmCheckNode } from './block-explain';

export type NmBlockResult = 'Blocked' | 'NotBlocked' | 'Warning' | 'Unknown';

export interface NmRuleView {
  name: string;
  result: NmBlockResult;
  checkResult: NmBlockResult;
  attempts: {
    question: string;
    attemptsTaken: number | null;
    lastAttempt: string | null;
    nextAttempt: string | null;
  }[];
  autoRelease: string | null;
  /** The rule's predicate from the configuration, annotated with this user's answers. */
  checks: BlockCheckNode[];
}

export interface NmProductView {
  storedKey: string;
  label: string;
  shortLabel: string;
  configKey: string;
  /** Present on the config document for this regulation. */
  gated: boolean;
  result: NmBlockResult;
  assessmentExpired: boolean | null;
  coolingOffEnd: string | null;
  isAllQuestionsAnswered: boolean | null;
  recalculatedOn: string | null;
  recalculationReason: string | null;
  configurationVersion: number | null;
  rules: NmRuleView[];
  /** First rule whose stored result is Blocked, if any. */
  blockingRule: string | null;
}

export type NmOutcome =
  | { kind: 'never-calculated'; provenance: Provenance }
  | { kind: 'no-config'; regulation: string | null; provenance: Provenance }
  | { kind: 'assessed'; products: NmProductView[]; provenance: Provenance };

function provenanceOf(raw: RawProfile): Provenance {
  return {
    regulation: regulationName(raw.regulation),
    configurationVersion: raw.configurationVersion ?? null,
    countryId: raw.countryId ?? null,
    verificationLevel: raw.verificationLevel ?? null,
    recalculationReason: recalculationReasonName(raw.recalculationReason),
    updatedOn: raw.updatedOn ?? null,
    lastAnswerOccurredAt: raw.lastAnswerOccurredAt ?? null,
  };
}

function nmRecalculationReason(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return recalculationReasonName(value);
}

function asBlockResult(value: string | null | undefined): NmBlockResult {
  if (value === 'Blocked' || value === 'NotBlocked' || value === 'Warning') return value;
  return 'Unknown';
}

function emptyProvenance(): Provenance {
  return {
    regulation: null,
    configurationVersion: null,
    countryId: null,
    verificationLevel: null,
    recalculationReason: null,
    updatedOn: null,
    lastAnswerOccurredAt: null,
  };
}

/**
 * Cosmos documents use PascalCase product keys (`Cfd`). The read path camelCases every
 * object key, so the same entry arrives as `cfd`. Catalog keys stay PascalCase (matching
 * config). Look up both spellings; treating them as different products was how CFD showed
 * twice — once as Unknown from the catalog miss, once as the camelCase stored row.
 */
function lookupStored(
  stored: RawProductNegativeMarkets,
  catalogKey: string,
): RawProductNegativeMarkets[string] | undefined {
  if (stored[catalogKey] !== undefined) return stored[catalogKey];
  const camel = catalogKey.charAt(0).toLowerCase() + catalogKey.slice(1);
  if (stored[camel] !== undefined) return stored[camel];
  const want = catalogKey.toLowerCase();
  for (const [key, value] of Object.entries(stored)) {
    if (key.toLowerCase() === want) return value;
  }
  return undefined;
}

function ruleView(stored: RawNmRuleResult | undefined, configRuleName: string): NmRuleView {
  return {
    name: stored?.rule ?? configRuleName,
    result: asBlockResult(stored?.result ?? undefined),
    checkResult: asBlockResult(stored?.checkResult ?? undefined),
    attempts: (stored?.attempts ?? []).map((a) => ({
      question: a.question ?? 'unknown',
      attemptsTaken: a.attemptsTaken ?? null,
      lastAttempt: a.lastAttemptOccurredAt ?? null,
      nextAttempt: a.nextAttemptStartDate ?? null,
    })),
    autoRelease: null,
    checks: [],
  };
}

function mergeProduct(
  definition: LoadedNegativeMarketProduct,
  stored: RawProductNegativeMarkets[string] | undefined,
  answers: AnswersByQuestion,
): NmProductView {
  const storedRules = new Map(
    (stored?.ruleResults ?? []).map((r) => [r.rule ?? '', r] as const),
  );

  const rules: NmRuleView[] = (definition.config.Rules ?? []).map((configRule) => {
    const storedRule = storedRules.get(configRule.Name);
    const view = ruleView(storedRule, configRule.Name);
    view.autoRelease = formatAutoRelease(configRule);
    view.checks = (configRule.Checks ?? []).map((check) => buildCheckNode(check, answers));
    return view;
  });

  const blockingRule = rules.find((r) => r.result === 'Blocked')?.name ?? null;

  return {
    storedKey: definition.storedKey,
    label: definition.label,
    shortLabel: definition.shortLabel,
    configKey: definition.configKey,
    gated: true,
    result: stored ? asBlockResult(stored.result ?? undefined) : 'Unknown',
    assessmentExpired: stored?.assessmentExpired ?? null,
    coolingOffEnd: stored?.coolingOffPeriodEndDate ?? null,
    isAllQuestionsAnswered: stored?.isAllQuestionsAnswered ?? null,
    recalculatedOn: stored?.recalculatedOn ?? null,
    recalculationReason: nmRecalculationReason(stored?.recalculationReason),
    configurationVersion: stored?.configurationVersion ?? null,
    rules,
    blockingRule,
  };
}

/** Stored-only products: on the profile but not in the loaded config (e.g. MAS Etf). */
function storedOnlyProduct(
  storedKey: string,
  stored: NonNullable<RawProductNegativeMarkets[string]>,
): NmProductView {
  const rules: NmRuleView[] = (stored.ruleResults ?? []).map((r) => ({
    name: r.rule ?? 'unknown',
    result: asBlockResult(r.result ?? undefined),
    checkResult: asBlockResult(r.checkResult ?? undefined),
    attempts: (r.attempts ?? []).map((a) => ({
      question: a.question ?? 'unknown',
      attemptsTaken: a.attemptsTaken ?? null,
      lastAttempt: a.lastAttemptOccurredAt ?? null,
      nextAttempt: a.nextAttemptStartDate ?? null,
    })),
    autoRelease: null,
    // No config document for this product, so there is no predicate to annotate.
    checks: [],
  }));

  return {
    storedKey,
    label: storedKey,
    shortLabel: storedKey,
    configKey: `${storedKey}NegativeMarket`,
    gated: true,
    result: asBlockResult(stored.result ?? undefined),
    assessmentExpired: stored.assessmentExpired ?? null,
    coolingOffEnd: stored.coolingOffPeriodEndDate ?? null,
    isAllQuestionsAnswered: stored.isAllQuestionsAnswered ?? null,
    recalculatedOn: stored.recalculatedOn ?? null,
    recalculationReason: nmRecalculationReason(stored.recalculationReason),
    configurationVersion: stored.configurationVersion ?? null,
    rules,
    blockingRule: rules.find((r) => r.result === 'Blocked')?.name ?? null,
  };
}

export function deriveNmOutcome(
  raw: RawProfile | null,
  config: LoadedConfig | null,
): NmOutcome {
  if (!raw) return { kind: 'never-calculated', provenance: emptyProvenance() };

  const provenance = provenanceOf(raw);
  const stored = raw.productNegativeMarkets ?? {};
  const configProducts = config?.negativeMarketProducts ?? [];
  const answers = answersByQuestion(raw.questionsAnswers);

  if (configProducts.length === 0 && Object.keys(stored).length === 0) {
    return {
      kind: 'no-config',
      regulation: provenance.regulation,
      provenance,
    };
  }

  const products: NmProductView[] = [];
  const seen = new Set<string>();

  for (const definition of configProducts) {
    products.push(mergeProduct(definition, lookupStored(stored, definition.storedKey), answers));
    seen.add(definition.storedKey.toLowerCase());
  }

  for (const [key, value] of Object.entries(stored)) {
    if (!value || seen.has(key.toLowerCase())) continue;
    products.push(storedOnlyProduct(key, value));
  }

  return { kind: 'assessed', products, provenance };
}

export function nmQuestionsFromConfig(config: LoadedConfig | null): ReadonlySet<string> {
  const names = new Set<string>();

  const walkChecks = (checks: BlockCheck[] | null) => {
    for (const check of checks ?? []) {
      for (const qac of check.QuestionAnswerChecks ?? []) {
        if (qac.Question) names.add(qac.Question);
      }
      if (check.NestedChecks?.length) walkChecks(check.NestedChecks);
    }
  };

  if (!config) return names;

  for (const product of config.negativeMarketProducts) {
    for (const rule of product.config.Rules ?? []) {
      walkChecks(rule.Checks);
    }
  }

  return names;
}
