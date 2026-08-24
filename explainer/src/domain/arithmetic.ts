/**
 * How each parent node combined its children.
 *
 * The tree the engine stores says what every node scored but not *why* a parent came out
 * where it did. That last step is the whole question a support agent is being asked, so this
 * module reads the operation off the user's own configuration document and reconstructs the
 * arithmetic.
 *
 * This is a *check*, not a recalculation. Every input is a level the engine itself stored, so
 * a disagreement means either the config version on screen is not the one that ran, or the
 * reading of the engine below is wrong. Either is worth seeing, which is why `agrees` is
 * surfaced rather than swallowed.
 *
 * The same walk also explains the leaves, because it is the walk that has the configuration
 * matched up to each node. See `leaf.ts` for how an answer becomes a question's level; the two
 * averaging paths and the weight tables they run against live in `scale.ts`.
 */

import type { ConfigComponent, ConfigFactor, LoadedConfig, Operation } from '@/config/types';
import { riskLevelDisplay, type RiskLevelName } from './ids';
import { explainLeaf, type LeafContext, type LeafExplanation } from './leaf';
import {
  compute,
  COMPONENT_SCALE_MULTIPLE,
  readRounding,
  roundHalfToEven,
  toScale,
  type Computed,
  type Scale,
} from './scale';
import type { TreeNode } from './tree';

export { roundHalfToEven };

export interface AggregationInput {
  title: string;
  level: RiskLevelName | null;
  weight: number | null;
}

export interface Aggregation {
  operation: Operation;
  /** Null when the node does not average, or when `Round` was absent. */
  rounding: 'Down' | 'Up' | null;
  inputs: AggregationInput[];
  /** Which weight table the arithmetic ran against. */
  scale: 'document' | 'component';
  /** Averaging only, before any rounding. */
  mean: number | null;
  computed: RiskLevelName | null;
  stored: RiskLevelName | null;
  /** False only when both levels are known and differ. Unknowns are not disagreements. */
  agrees: boolean;
  /** A sentence that stands on its own next to the node's badge. */
  summary: string;
}

export interface TreeExplanation {
  /** Keyed by `TreeNode.id`. Absent for leaves and for nodes with no matching config entry. */
  byNodeId: Map<string, Aggregation>;
  /** Keyed by `TreeNode.id`, for question nodes only. */
  leafByNodeId: Map<string, LeafExplanation>;
  /** Factors into the final level. Not a tree node — the root is the result itself. */
  root: Aggregation | null;
  warnings: string[];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}

function noun(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function describe(
  operation: Operation,
  rounding: 'Down' | 'Up' | null,
  inputs: AggregationInput[],
  computed: Computed,
  childNoun: string,
): string {
  const levels = inputs.map((i) => riskLevelDisplay(i.level)).join(', ');
  const count = noun(inputs.length, childNoun);

  if (operation === 'Min') return `Lowest of the ${count} — ${levels}.`;
  if (operation === 'Max') return `Highest of the ${count} — ${levels}.`;

  if (operation === 'Avg' && computed.mean !== null) {
    const sum = inputs.map((i) => i.weight).join(' + ');
    const direction = rounding === 'Down' ? 'rounded down' : 'rounded up';
    const tail = computed.scale === 'component'
      ? `, ${direction} to the nearest ${COMPONENT_SCALE_MULTIPLE}: ${computed.weight}`
      : `, ${direction} to ${computed.weight}`;
    return `Average of the ${count}, weighted — (${sum}) ÷ ${inputs.length} = ${formatNumber(computed.mean)}${tail}.`;
  }

  return `${operation} of the ${count} — ${levels}.`;
}

function aggregate(
  operation: Operation,
  rounding: 'Down' | 'Up' | null,
  children: { title: string; riskLevel: RiskLevelName | null }[],
  stored: RiskLevelName | null,
  documentScale: Scale,
  componentScale: Scale | null,
  childNoun: string,
): Aggregation | null {
  const levels = children.map((c) => c.riskLevel);
  if (levels.some((l) => l === null)) return null;

  const activeScale = operation === 'Avg' && componentScale ? componentScale : documentScale;
  const inputs: AggregationInput[] = children.map((child) => ({
    title: child.title,
    level: child.riskLevel,
    weight: child.riskLevel === null ? null : (activeScale.byLevel.get(child.riskLevel) ?? null),
  }));

  const computed = compute(operation, rounding, levels as RiskLevelName[], documentScale, componentScale);
  if (!computed) return null;

  return {
    operation,
    rounding,
    inputs,
    scale: computed.scale,
    mean: computed.mean,
    computed: computed.level,
    stored,
    agrees: computed.level === null || stored === null || computed.level === stored,
    summary: describe(operation, rounding, inputs, computed, childNoun),
  };
}

/**
 * Which single input decided a Min or Max node, as an index into `inputs`.
 *
 * Null when nothing can be singled out, and every case matters. A single input was not chosen over
 * anything, so calling it decisive says nothing. Averaging has no determinant at all — every input
 * moved the mean. And a tie has no *single* one: marking one of several equal inputs would claim
 * the others were irrelevant when removing the marked one changes nothing. In the last two cases
 * `summary` already lists every input, which is the honest answer.
 */
export function determinant(aggregation: Aggregation): number | null {
  if (aggregation.operation !== 'Min' && aggregation.operation !== 'Max') return null;
  if (aggregation.stored === null || aggregation.inputs.length < 2) return null;

  const matches = aggregation.inputs.flatMap((input, index) =>
    input.level === aggregation.stored ? [index] : [],
  );
  return matches.length === 1 ? matches[0] : null;
}

/** The user's answers, indexed the way the engine looks them up. */
export interface AnswerLookup {
  questionId: number;
  answerIds: number[];
}

export function explainTree(
  nodes: TreeNode[],
  storedOverall: RiskLevelName | null,
  config: LoadedConfig | null,
  answers: AnswerLookup[] = [],
): TreeExplanation {
  const byNodeId = new Map<string, Aggregation>();
  const leafByNodeId = new Map<string, LeafExplanation>();
  const warnings: string[] = [];
  const unmatched: string[] = [];

  const answersByQuestion = new Map<number, number[]>(
    answers.map((entry) => [entry.questionId, entry.answerIds]),
  );

  const documentScale = toScale(config?.riskLevelWeight);
  if (!config || !documentScale) {
    return {
      byNodeId,
      leafByNodeId,
      root: null,
      warnings: config
        ? ['The configuration carries no risk-level weight table, so the arithmetic behind each level cannot be shown.']
        : [],
    };
  }

  const factorsByName = new Map<string, ConfigFactor>(
    config.factors.map((factor) => [factor.Name, factor]),
  );

  for (const factorNode of nodes) {
    const factorConfig = factorNode.rawName ? factorsByName.get(factorNode.rawName) : undefined;
    if (!factorConfig) {
      unmatched.push(factorNode.title);
      for (const componentNode of factorNode.children) {
        for (const questionNode of componentNode.children) {
          leafByNodeId.set(
            questionNode.id,
            explainLeaf(null, questionNode.questionId, null, questionNode.riskLevel),
          );
        }
      }
      continue;
    }

    const componentsByName = new Map<string, ConfigComponent>(
      (factorConfig.Components ?? []).map((component) => [component.Name, component]),
    );

    for (const componentNode of factorNode.children) {
      const componentConfig = componentNode.rawName
        ? componentsByName.get(componentNode.rawName)
        : undefined;
      if (!componentConfig) {
        unmatched.push(componentNode.title);
        // Still explain the leaves as best we can — "not in this configuration" is a more useful
        // thing to say on a question than saying nothing at all.
        for (const questionNode of componentNode.children) {
          leafByNodeId.set(
            questionNode.id,
            explainLeaf(null, questionNode.questionId, null, questionNode.riskLevel),
          );
        }
        continue;
      }

      // `CalculateComponentResult`: the component's own default wins, then the document's.
      const defaultLevel = (componentConfig.DefaultRiskLevel ?? config.defaultRiskLevel ?? null) as
        | RiskLevelName
        | null;
      const questionsByName = new Map(
        (componentConfig.QuestionAnswers ?? []).map((question) => [question.Question, question]),
      );

      for (const questionNode of componentNode.children) {
        // The tree names a question by its enum name, which is exactly how the config keys it.
        const questionConfig = questionNode.rawName
          ? questionsByName.get(questionNode.rawName)
          : undefined;
        const context: LeafContext | null = questionConfig
          ? {
              question: questionConfig,
              // Questions are combined with the *component's* operation, not one of their own.
              operation: componentConfig.Operation,
              rounding: readRounding(componentConfig.Round),
              defaultLevel,
              documentScale,
            }
          : null;
        leafByNodeId.set(
          questionNode.id,
          explainLeaf(
            context,
            questionNode.questionId,
            questionNode.questionId === null
              ? null
              : (answersByQuestion.get(questionNode.questionId) ?? null),
            questionNode.riskLevel,
          ),
        );
      }

      const aggregation = aggregate(
        componentConfig.Operation,
        readRounding(componentConfig.Round),
        componentNode.children,
        componentNode.riskLevel,
        documentScale,
        toScale(componentConfig.RiskLevelWeight),
        'question',
      );
      if (aggregation) byNodeId.set(componentNode.id, aggregation);
    }

    const aggregation = aggregate(
      factorConfig.Operation,
      readRounding(factorConfig.Round),
      factorNode.children,
      factorNode.riskLevel,
      documentScale,
      null,
      'component',
    );
    if (aggregation) byNodeId.set(factorNode.id, aggregation);
  }

  const root = config.rootOperation
    ? aggregate(
        config.rootOperation,
        readRounding(config.rootRounding),
        nodes,
        storedOverall,
        documentScale,
        null,
        'factor',
      )
    : null;

  if (unmatched.length > 0) {
    warnings.push(
      `${unmatched.length} node(s) have no counterpart in ${config.id} (${unmatched.join(', ')}), ` +
        'so the arithmetic behind them is not shown. The configuration on screen is probably not the one that ran.',
    );
  }

  const disagreements = [...byNodeId.values()].filter((a) => !a.agrees).length +
    (root && !root.agrees ? 1 : 0);
  if (disagreements > 0) {
    warnings.push(
      `${disagreements} node(s) do not reproduce: applying ${config.id}'s own operation to the ` +
        'levels the engine stored gives a different answer than the engine stored for the parent. ' +
        'Trust the stored level, not this arithmetic, and treat the difference as a bug here or a config mismatch.',
    );
  }

  // A leaf that does not reproduce is a stronger signal than a parent that does not, because the
  // answer is the one input we did not get from the engine. The usual cause is that the answer
  // changed after the result was calculated, which the profile page checks separately.
  const leafDisagreements = [...leafByNodeId.values()].filter((leaf) => !leaf.agrees).length;
  if (leafDisagreements > 0) {
    warnings.push(
      `${leafDisagreements} question(s) do not reproduce from the answers on record: scoring the ` +
        `stored answer against ${config.id} gives a different level than the engine stored for that ` +
        'question. Most often the answer was changed after this result was calculated, so the tree ' +
        'is older than the answers shown.',
    );
  }

  return { byNodeId, leafByNodeId, root, warnings };
}
