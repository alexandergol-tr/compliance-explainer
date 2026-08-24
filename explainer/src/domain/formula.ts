/**
 * The rules that would apply to anyone under a given regulation, read off the configuration
 * document rather than written down here.
 *
 * The tree above a profile answers "how did *this* user reach this level". This answers "what is
 * the rule", which is a different question and the one people ask when they want to check whether
 * an outcome is correct rather than just reproducible. Deriving it from the document is what keeps
 * the two consistent: if a regulation retunes a weight or adds a component, both change together.
 *
 * Everything here except the monitoring gate comes from the document. That one exception is
 * labelled, because its inputs live in service code and CCM.
 */

import { answerText, questionText } from './copy';
import { KycAnswerIds, KycQuestionIds } from './generated/kyc-enums';
import { componentTitle, humanise } from './labels';
import type {
  BlockCheck,
  ConfigComponent,
  ConfigFactor,
  LoadedConfig,
  Operation,
  Rounding,
} from '@/config/types';

/** One assignment in the scoring formula, ordered root-first. */
export interface FormulaLine {
  /** `root` | `factor` | `component`, which is all the indentation needs. */
  level: 'root' | 'factor' | 'component';
  /** Short symbol used on the left of the assignment and referenced by its parent: `A`, `C5`. */
  symbol: string;
  /** What the symbol means, for the rows where the symbol alone is opaque. */
  name: string | null;
  /** The right-hand side, e.g. `Min(A, B)` or `Avg(C1, C2, C3)`. */
  expression: string;
  /** Rounding, own weight scale, per-component default — only when the node has one. */
  qualifiers: string[];
}

export interface BlockCondition {
  question: string;
  /** Customer-facing wording where it exists, falling back to the identifier. */
  answers: string[];
  /** `Any` on every live check: one matching answer satisfies this row. */
  match: string;
}

export interface BlockRule {
  /** `All` on every live check: every row must be satisfied to block. */
  combinator: string;
  conditions: BlockCondition[];
  result: string;
  /**
   * Set only where a check declares a fallback that differs from the block's own, which is
   * FCA and nowhere else. The engine never reads it — see verification.md C-50 — so a reader
   * comparing configs would otherwise conclude FCA fails closed when it does not.
   */
  unreachableFallback: string | null;
}

export interface Formula {
  id: string;
  regulation: string;
  version: number;
  lines: FormulaLine[];
  defaultRiskLevel: string | null;
  /** Level → weight, descending by weight, as the averaging uses it. */
  weights: { level: string; weight: number }[];
  /** Components that override the document scale, which is Component 9 and nothing else. */
  componentScales: { symbol: string; name: string | null; weights: { level: string; weight: number }[] }[];
  scores: { level: string; score: number }[];
  blocks: BlockRule[];
  /** The block's own fallback, which is what the engine actually applies on fall-through. */
  blockFallback: string | null;
}

const OPERATION_WORD: Readonly<Record<Operation, string>> = {
  Min: 'Min',
  Max: 'Max',
  Avg: 'Avg',
  Sum: 'Sum',
};

/**
 * Only `Down` and `Up` are members of `Round`; the `0` on every non-averaging node is
 * `default(Round)` surviving serialisation and must not be read as a direction.
 */
function roundingWord(rounding: Rounding): 'down' | 'up' | null {
  if (rounding === 'Down' || rounding === 2) return 'down';
  if (rounding === 'Up' || rounding === 1) return 'up';
  return null;
}

/** Rounding is only worth stating where it can change the answer, which means averaging. */
function qualifiersFor(operation: Operation, rounding: Rounding): string[] {
  if (operation !== 'Avg' && operation !== 'Sum') return [];
  const word = roundingWord(rounding);
  return [word ? `rounded ${word}` : 'rounded up, the engine default for an unset direction'];
}

function componentSymbol(component: ConfigComponent): string {
  return /^\d+$/.test(component.Name) ? `C${component.Name}` : component.Name;
}

function factorSymbol(factor: ConfigFactor): string {
  return factor.Name.length <= 2 ? `Factor ${factor.Name}` : factor.Name;
}

/**
 * Drops the prefix every question in a component shares, because the component's own name already
 * carries it. Component 9's five questions are all `MiCACryptoAssessment…`, which reads as five
 * repetitions of the component title and buries the part that differs.
 *
 * Only fires with three or more questions and a prefix long enough to be deliberate, so the
 * accidental overlap in a pair like `Equities`/`EquitiesInvestedAmount` is left alone.
 */
function trimSharedPrefix(identifiers: string[]): string[] {
  if (identifiers.length < 3) return identifiers;

  let prefix = identifiers[0];
  for (const identifier of identifiers.slice(1)) {
    while (prefix && !identifier.startsWith(prefix)) prefix = prefix.slice(0, -1);
    if (!prefix) return identifiers;
  }

  // Cut back to a word boundary so the remainder starts a word rather than mid-token.
  while (prefix.length > 0 && !/[a-z]/.test(prefix.at(-1) ?? '')) prefix = prefix.slice(0, -1);
  if (prefix.length < 8) return identifiers;

  const trimmed = identifiers.map((identifier) => identifier.slice(prefix.length));
  return trimmed.some((name) => name.length === 0) ? identifiers : trimmed;
}

function componentLine(component: ConfigComponent): FormulaLine {
  const questions = component.QuestionAnswers ?? [];
  const qualifiers = qualifiersFor(component.Operation, component.Round ?? null);

  if (component.RiskLevelWeight?.length) {
    // A component-level scale is not cosmetic: averaging runs on it and truncates to its step
    // rather than to an integer, so the same answers give a different level.
    qualifiers.push('on its own weight scale');
  }
  if (component.DefaultRiskLevel) {
    qualifiers.push(`${component.DefaultRiskLevel} when unanswered`);
  }

  return {
    level: 'component',
    symbol: componentSymbol(component),
    name: /^\d+$/.test(component.Name) ? componentTitle(component.Name).replace(/^Component \d+ — /, '') : null,
    expression: `${OPERATION_WORD[component.Operation]}(${
      questions.length === 0
        ? 'no questions'
        : trimSharedPrefix(questions.map((question) => question.Question))
            .map(humanise)
            .join(', ')
    })`,
    qualifiers,
  };
}

function blockCondition(check: { Question: string; Answers: string[] | null; Condition?: string }): BlockCondition {
  const questionId = KycQuestionIds[check.Question];
  const question = questionId === undefined ? check.Question : questionText(questionId).text;

  const answers = (check.Answers ?? []).map((name) => {
    const answerId = KycAnswerIds[name];
    if (questionId === undefined || answerId === undefined) return name;
    return answerText(questionId, answerId).text;
  });

  return { question, answers, match: check.Condition ?? 'Any' };
}

function blockRule(check: BlockCheck, blockFallback: string | null): BlockRule {
  return {
    combinator: check.Condition,
    conditions: (check.QuestionAnswerChecks ?? []).map(blockCondition),
    result: check.Result,
    unreachableFallback:
      check.DefaultResult && check.DefaultResult !== blockFallback ? check.DefaultResult : null,
  };
}

function byWeightDescending(weights: { RiskLevel: string; Weight: number }[]) {
  return [...weights]
    .sort((a, b) => b.Weight - a.Weight)
    .map((w) => ({ level: w.RiskLevel, weight: w.Weight }));
}

export function deriveFormula(config: LoadedConfig): Formula | null {
  if (!config.scoresSuitability || !config.rootOperation) return null;

  const lines: FormulaLine[] = [
    {
      level: 'root',
      symbol: 'Client risk level',
      name: null,
      expression: `${OPERATION_WORD[config.rootOperation]}(${config.factors
        .map(factorSymbol)
        .join(', ')})`,
      qualifiers: qualifiersFor(config.rootOperation, config.rootRounding),
    },
  ];

  const componentScales: Formula['componentScales'] = [];

  // Document order, which is the order the stored tree uses, so this section and the tree above
  // read down the page the same way. Remediation order is a separate thing and shown on the tree.
  for (const factor of config.factors) {
    const components = factor.Components ?? [];
    lines.push({
      level: 'factor',
      symbol: factorSymbol(factor),
      name: null,
      expression: `${OPERATION_WORD[factor.Operation]}(${components
        .map(componentSymbol)
        .join(', ')})`,
      qualifiers: qualifiersFor(factor.Operation, factor.Round),
    });

    for (const component of components) {
      const line = componentLine(component);
      lines.push(line);
      if (component.RiskLevelWeight?.length) {
        componentScales.push({
          symbol: line.symbol,
          name: line.name,
          weights: byWeightDescending(component.RiskLevelWeight),
        });
      }
    }
  }

  return {
    id: config.id,
    regulation: config.regulation,
    version: config.version,
    lines,
    defaultRiskLevel: config.defaultRiskLevel,
    weights: byWeightDescending(config.riskLevelWeight),
    componentScales,
    scores: Object.entries(config.scoreMappings)
      .map(([level, score]) => ({ level, score }))
      .sort((a, b) => a.score - b.score),
    blocks: [...config.blockChecks]
      .sort((a, b) => a.Priority - b.Priority)
      .map((check) => blockRule(check, config.blockDefaultResult)),
    blockFallback: config.blockDefaultResult,
  };
}
