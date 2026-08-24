/**
 * The calculation tree: factor -> component -> question, with a risk level on every node.
 *
 * The engine persists this itself, so this module reads and normalises rather than
 * calculating. Reimplementing the scoring here would create a second implementation that
 * drifts from the first, and every disagreement would get blamed on the engine.
 *
 * Two things about the stored shape drive the design here, both measured against 578
 * production trees (7,231 question nodes) rather than inferred from the C# types:
 *
 *   - **No node carries a level discriminator.** `SuitabilityCalculationDetailLevel` exists
 *     as an enum and is used by the SQL projection, but it is absent from every stored
 *     document. Depth is therefore the mechanism, not a fallback — the tree is always
 *     exactly three levels deep, and no deeper nodes exist anywhere in the sample.
 *   - **Question identity is an enum *name*, not an id.** `QuestionResult.Question` is a
 *     `KycQuestion`, serialised by name, and where present it is always byte-identical to
 *     `Name`. It is absent on 289 of 7,231 leaves (older configuration versions such as
 *     FCA-14), where `Name` alone carries the identity.
 *
 * So warnings are reserved for genuine anomalies — a tree deeper than three levels, a
 * subtype field at the wrong depth, a question name that resolves to no known enum member.
 * Warning about depth-derived levels would fire on every real document and train the reader
 * to ignore the warning strip.
 */

import { questionText } from './copy';
import { LEVEL_BY_DEPTH, riskLevelName, type NodeLevel, type RiskLevelName } from './ids';
import { KycQuestionIds } from './generated/kyc-enums';
import { componentTitle, labelFromIdentifier, type Label } from './labels';

/** As it arrives from Cosmos or the SQL projection — every field optional. */
export interface RawNode {
  name?: string | null;
  /** `Childs`, spelled that way in the C# model. `children` accepted too. */
  childs?: RawNode[] | null;
  children?: RawNode[] | null;
  clientRiskLevel?: number | string | null;
  /** Question nodes only. The `KycQuestion` enum name, or its numeric id from SQL. */
  question?: number | string | null;
  /** Factor nodes only. */
  revolvingDoorOrder?: number | null;
}

export interface TreeNode {
  id: string;
  level: NodeLevel;
  /** Raw `Name` from the payload. Doubles as the identity of factor and question nodes. */
  rawName: string | null;
  /** What to actually show. */
  title: string;
  riskLevel: RiskLevelName | null;
  /** Resolved from the question's enum name. Null when the name matches no enum member. */
  questionId: number | null;
  questionLabel: Label | null;
  revolvingDoorOrder: number | null;
  children: TreeNode[];
}

export interface NormalisedTree {
  nodes: TreeNode[];
  /** Genuine anomalies only. Surface these; do not swallow them. */
  warnings: string[];
  counts: Record<NodeLevel, number>;
}

function childrenOf(node: RawNode): RawNode[] {
  return node.childs ?? node.children ?? [];
}

/**
 * Question nodes identify themselves by enum name in `Question`, falling back to `Name`.
 * SQL's projection stores the numeric id instead, so both are accepted.
 */
function resolveQuestion(node: RawNode): { id: number | null; identifier: string | null } {
  const candidates = [node.question, node.name];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    if (typeof candidate === 'number') {
      return { id: candidate, identifier: null };
    }
    const asNumber = Number(candidate);
    if (Number.isFinite(asNumber) && candidate.trim() !== '') {
      return { id: asNumber, identifier: null };
    }
    const id = KycQuestionIds[candidate];
    if (id !== undefined) return { id, identifier: candidate };
    // A name that resolves to nothing is still the node's identity; keep it for display
    // and let the caller warn.
    return { id: null, identifier: candidate };
  }
  return { id: null, identifier: null };
}

export function normaliseTree(raw: RawNode[] | null | undefined): NormalisedTree {
  const warnings: string[] = [];
  const counts: Record<NodeLevel, number> = { factor: 0, component: 0, question: 0 };
  const unresolvedNames = new Set<string>();
  let unnamedQuestions = 0;
  let tooDeep = 0;
  let misplacedSubtypeFields = 0;

  function walk(nodes: RawNode[], depth: number, path: string): TreeNode[] {
    return nodes.map((node, index) => {
      const id = `${path}${index}`;
      const kids = childrenOf(node);

      if (depth >= LEVEL_BY_DEPTH.length) tooDeep += 1;
      const level = LEVEL_BY_DEPTH[Math.min(depth, LEVEL_BY_DEPTH.length - 1)];
      counts[level] += 1;

      // The subtype-only fields corroborate the depth reading. Disagreement means the
      // payload is not the shape this app was built against, which is worth saying.
      const hasQuestionField = node.question !== null && node.question !== undefined;
      const hasOrderField = node.revolvingDoorOrder !== null && node.revolvingDoorOrder !== undefined;
      if ((hasQuestionField && level !== 'question') || (hasOrderField && level !== 'factor')) {
        misplacedSubtypeFields += 1;
      }

      let questionId: number | null = null;
      let label: Label | null = null;
      if (level === 'question') {
        const resolved = resolveQuestion(node);
        questionId = resolved.id;
        // The question as the customer was asked it, where the funnel catalogue has it. The enum
        // name survives on `identifier` because that is what the configuration keys on.
        if (resolved.id !== null) label = questionText(resolved.id);
        else if (resolved.identifier) {
          label = labelFromIdentifier(resolved.identifier);
          unresolvedNames.add(resolved.identifier);
        } else {
          unnamedQuestions += 1;
        }
      }

      const title =
        level === 'component'
          ? componentTitle(node.name ?? null)
          : level === 'factor'
            ? node.name
              ? `Factor ${node.name}`
              : 'Factor'
            : (label?.text ?? 'Question');

      return {
        id,
        level,
        rawName: node.name ?? null,
        title,
        riskLevel: riskLevelName(node.clientRiskLevel),
        questionId,
        questionLabel: label,
        revolvingDoorOrder: node.revolvingDoorOrder ?? null,
        children: walk(kids, depth + 1, `${id}.`),
      };
    });
  }

  const nodes = walk(raw ?? [], 0, '');

  if (tooDeep > 0) {
    warnings.push(
      `${tooDeep} nodes sit deeper than the three levels this tree is known to have, and were ` +
        'rendered as questions. The stored shape has changed and this view may be misreading it.',
    );
  }
  if (misplacedSubtypeFields > 0) {
    warnings.push(
      `${misplacedSubtypeFields} nodes carry a subtype field at the wrong depth — a question id ` +
        'above the leaves, or a revolving-door order below the factors. Levels here are derived ' +
        'from depth, so a contradiction means the payload shape is not what this view assumes.',
    );
  }
  if (unresolvedNames.size > 0) {
    warnings.push(
      `${unresolvedNames.size} question name(s) match no member of the KycQuestion enum: ` +
        `${[...unresolvedNames].join(', ')}. The enum snapshot is probably older than the ` +
        'configuration that produced this result.',
    );
  }
  if (unnamedQuestions > 0) {
    warnings.push(
      `${unnamedQuestions} question nodes carry neither a question field nor a name, so they ` +
        'cannot be identified at all.',
    );
  }
  // Deliberately no warning for an empty tree. The normaliser cannot know *why* it is empty —
  // an internal account, a below-verification user and a non-scoring regulation all produce one
  // legitimately — and a warning that guesses the reason is worse than none. The caller knows
  // the outcome kind, so it decides whether emptiness is surprising.

  return { nodes, warnings, counts };
}

function countAll(nodes: TreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countAll(node.children), 0);
}

export { countAll };
