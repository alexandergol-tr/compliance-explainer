/**
 * Annotate a BlockCheck tree with this user's answers.
 *
 * Suitability hard-block and Negative Market rules use the same `Checks` shape. The stored
 * verdict is never recomputed here — `matched` on a leaf means "this answer is in the blocking
 * set", which is the input a reader needs, not a substitute for the engine.
 */

import type { BlockCheck, LoadedConfig, QuestionAnswerCheck } from '@/config/types';
import type { RawQuestionAnswers } from '@/sources/types';
import { answerText, questionText } from './copy';
import { KycAnswerIds, KycQuestionIds } from './generated/kyc-enums';

export type AnswersByQuestion = Map<number, number[]>;

export interface BlockAnswer {
  id: number | null;
  /** Enum identifier from the config or funnel, kept for cross-checking against the document. */
  name: string;
  text: string;
}

export interface BlockCheckLeaf {
  kind: 'leaf';
  question: string;
  questionLabel: string;
  questionId: number | null;
  condition: string;
  blocksOn: BlockAnswer[];
  excludeAnswers: BlockAnswer[];
  /** A summed assessment. Membership matching does not apply. */
  scored: boolean;
  userAnswers: BlockAnswer[];
  answered: boolean;
  /** The user selected a blocking answer (non-scored checks only). */
  matched: boolean;
  /**
   * `IsRequired` on the config check. An unanswered required question inside a `DefaultResult:
   * Blocked` group fails **closed** on the Negative Market path — the engine returns the
   * default rather than treating the group's `All` as unsatisfied. See nm-formulas.md §1.1.
   */
  isRequired: boolean;
}

export interface BlockCheckGroup {
  kind: 'group';
  condition: string;
  minCount: number;
  result: string;
  isAlternative: boolean;
  /**
   * The check's `DefaultResult`. Live on the Negative Market path (`CalculateWithBlockResult`),
   * where a group that cannot be evaluated returns this value. `Blocked` here means the group
   * fails closed on missing required answers — the difference between "AND of the answers" and
   * "AND if evaluable, otherwise Blocked".
   */
  defaultResult: string;
  children: BlockCheckNode[];
}

export type BlockCheckNode = BlockCheckLeaf | BlockCheckGroup;

export function answersByQuestion(
  answers: RawQuestionAnswers[] | null | undefined,
): AnswersByQuestion {
  const map: AnswersByQuestion = new Map();
  for (const entry of answers ?? []) {
    if (entry && typeof entry.questionId === 'number') {
      map.set(entry.questionId, entry.answerIds ?? []);
    }
  }
  return map;
}

function resolveAnswerName(questionId: number | null, name: string): BlockAnswer {
  const id = KycAnswerIds[name] ?? null;
  const text = id !== null ? answerText(questionId, id).text : name;
  return { id, name, text };
}

function resolveAnswerId(questionId: number | null, id: number): BlockAnswer {
  const resolved = answerText(questionId, id);
  return { id, name: resolved.identifier ?? String(id), text: resolved.text };
}

function buildLeaf(qac: QuestionAnswerCheck, answers: AnswersByQuestion): BlockCheckLeaf {
  const questionId = KycQuestionIds[qac.Question] ?? null;
  const condition = qac.Condition ?? 'Any';
  const blocksOn = (qac.Answers ?? []).map((n) => resolveAnswerName(questionId, n));
  const excludeAnswers = (qac.ExcludeAnswers ?? []).map((n) => resolveAnswerName(questionId, n));
  const scored = Boolean(qac.ScoreAnswers?.Answers?.length);

  const userIds = questionId !== null ? (answers.get(questionId) ?? []) : [];
  const answered = questionId !== null && answers.has(questionId);
  const userAnswers = userIds.map((id) => resolveAnswerId(questionId, id));

  const blockingIds = new Set(blocksOn.map((a) => a.id).filter((x): x is number => x !== null));
  const excludeIds = new Set(
    excludeAnswers.map((a) => a.id).filter((x): x is number => x !== null),
  );

  const userIdSet = new Set(userIds);
  const excluded = userIds.some((id) => excludeIds.has(id));
  // `All` means every listed answer must be selected; `Any` (and anything else) means one is
  // enough. Reading `All` as `some` is what painted a single Salary answer as a Pension+Salary
  // match on FCA CFD KnockOut.
  const membership =
    condition === 'All'
      ? blockingIds.size > 0 && [...blockingIds].every((id) => userIdSet.has(id))
      : userIds.some((id) => blockingIds.has(id));
  const matched = !scored && membership && !excluded;

  return {
    kind: 'leaf',
    question: qac.Question,
    questionLabel: questionText(questionId).text,
    questionId,
    condition,
    blocksOn,
    excludeAnswers,
    scored,
    userAnswers,
    answered,
    matched,
    isRequired: qac.IsRequired ?? false,
  };
}

export function buildCheckNode(check: BlockCheck, answers: AnswersByQuestion): BlockCheckGroup {
  const children: BlockCheckNode[] = [];
  for (const qac of check.QuestionAnswerChecks ?? []) children.push(buildLeaf(qac, answers));
  for (const nested of check.NestedChecks ?? []) children.push(buildCheckNode(nested, answers));
  return {
    kind: 'group',
    condition: check.Condition,
    minCount: check.MinCount,
    result: check.Result,
    isAlternative: check.IsAlternative,
    defaultResult: check.DefaultResult,
    children,
  };
}

export function matchedLeaves(nodes: BlockCheckNode[]): BlockCheckLeaf[] {
  const out: BlockCheckLeaf[] = [];
  const walk = (node: BlockCheckNode) => {
    if (node.kind === 'leaf') {
      if (node.matched) out.push(node);
      return;
    }
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

/**
 * The leaves that actually explain a block, deduped by question.
 *
 * `matchedLeaves` returns every answer in a blocking set, which over-reports: inside an `All`
 * group a single matching answer is "in the set" but does not trip the group unless all its
 * non-scored siblings also match. It also repeats a question that appears in several checks (FCA
 * CFD lists net annual income in three). This mirrors the per-leaf "Triggers block" heuristic in
 * `block-checks.tsx` so the summary and the tree cannot disagree. The engine verdict is still not
 * recomputed — callers only show this when the stored result is Blocked.
 */
export function decisiveLeaves(nodes: BlockCheckNode[]): BlockCheckLeaf[] {
  const out: BlockCheckLeaf[] = [];

  const walkGroup = (group: BlockCheckGroup) => {
    const leafChildren = group.children.filter(
      (c): c is BlockCheckLeaf => c.kind === 'leaf' && !c.scored,
    );
    const siblingsAllMatched = leafChildren.length > 0 && leafChildren.every((c) => c.matched);
    const completes = group.condition !== 'All' || siblingsAllMatched;
    for (const child of group.children) {
      if (child.kind === 'leaf') {
        if (child.matched && completes) out.push(child);
      } else {
        walkGroup(child);
      }
    }
  };

  for (const node of nodes) {
    if (node.kind === 'leaf') {
      if (node.matched) out.push(node);
    } else {
      walkGroup(node);
    }
  }

  const seen = new Set<string>();
  return out.filter((leaf) => {
    const key = leaf.questionId !== null ? `q${leaf.questionId}` : leaf.question;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Suitability `SuitabilityBlock.Checks`, annotated with this user's answers. */
export function explainHardBlock(
  config: LoadedConfig | null,
  answers: RawQuestionAnswers[] | null | undefined,
): BlockCheckNode[] {
  if (!config) return [];
  const map = answersByQuestion(answers);
  return [...config.blockChecks]
    .sort((a, b) => a.Priority - b.Priority)
    .map((check) => buildCheckNode(check, map));
}
