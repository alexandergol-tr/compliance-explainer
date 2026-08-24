import { RISK_INK, RiskBadge } from './risk-badge';
import { determinant, type Aggregation, type TreeExplanation } from '@/domain/arithmetic';
import type { AnswerText } from '@/domain/copy';
import { RISK_LEVEL_DISPLAY, riskLevelDisplay } from '@/domain/ids';
import type { LeafExplanation, WeightedStatement } from '@/domain/leaf';
import type { NormalisedTree, TreeNode } from '@/domain/tree';

/**
 * The calculation path: factors as collapsible sections, components nested inside them, questions
 * as rows at the bottom. Each level states its rule on the right in mono, so you can read down the
 * right-hand edge to see how the tree combines before reading a single answer.
 *
 * Each parent carries the arithmetic that produced it and each leaf carries the answer that
 * produced it, when the configuration that ran is available. Without those the tree answers
 * "what did this score" but not "why", which is the question people actually arrive with.
 *
 * Question and answer ids are deliberately absent here and present in the answers table. They are
 * needed to cross-check a result against a configuration document, but that is one task done once,
 * not something to carry on every row of the thing you actually read.
 */

const RULE = 'ml-auto shrink-0 font-mono text-[11px] text-muted';
const CAUTION = 'text-[11.5px] text-caution';

/** `MAX of 3 questions`, or just `1 question` where there is nothing to combine. */
function ruleText(aggregation: Aggregation | undefined, childNoun: string, count: number): string {
  const children = `${count} ${childNoun}${count === 1 ? '' : 's'}`;
  if (!aggregation || count <= 1) return children;

  const rounding =
    aggregation.operation === 'Avg'
      ? `, rounded ${aggregation.rounding === 'Down' ? 'down' : 'up'}`
      : '';
  return `${aggregation.operation.toUpperCase()} of ${children}${rounding}`;
}

function Arrow() {
  return (
    <span className="sx-arrow" aria-hidden>
      ▸
    </span>
  );
}

/** A parent's arithmetic, and loudly when it does not reproduce. */
function Arithmetic({ aggregation }: { aggregation: Aggregation }) {
  return (
    <p className={`text-[11.5px] ${aggregation.agrees ? 'text-muted' : CAUTION}`}>
      {aggregation.summary}
      {!aggregation.agrees && (
        <span className="ml-1 font-medium">
          That gives {riskLevelDisplay(aggregation.computed)}, but the engine stored{' '}
          {riskLevelDisplay(aggregation.stored)} — trust the stored level.
        </span>
      )}
    </p>
  );
}

/**
 * Wording the customer saw is set in roman; wording reconstructed from an internal identifier is
 * set in italics, with the reason on hover.
 *
 * The distinction stays because dropping it would put words in the customer's mouth — "Confirmed"
 * and "Answer 350" are not things anyone was shown. Italics carry that without a badge.
 */
function Copy({ copy }: { copy: Pick<AnswerText, 'text' | 'source'> }) {
  if (copy.source === 'static-data') return <>{copy.text}</>;
  return (
    <span
      className="italic"
      title="Reconstructed from the internal identifier — no customer-facing wording is available for this option."
    >
      {copy.text}
    </span>
  );
}

/**
 * Component 8's quiz, as a table, because the scoring is the point.
 *
 * Every statement contributes whether or not it was selected — `GetScoreByAnswerIds` subtracts
 * the score of anything unselected — so showing only the selected ones would make the total look
 * arbitrary. The unselected rows are why it adds up.
 */
function WeightedTable({ statements, total }: { statements: WeightedStatement[]; total: number }) {
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-hairline">
      <table className="w-full text-[11.5px]">
        <thead>
          <tr className="bg-[var(--etoro-white-08)] text-left font-mono text-[10.5px] uppercase tracking-[0.05em] text-muted">
            <th className="px-2.5 py-1.5 font-medium">Statement</th>
            <th className="px-2.5 py-1.5 font-medium">Selected</th>
            <th className="px-2.5 py-1.5 text-right font-medium">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {statements.map((statement) => (
            <tr
              key={statement.identifier}
              className={`border-t border-hairline ${
                statement.offered ? '' : 'bg-[rgba(237,197,0,0.06)]'
              }`}
            >
              <td className="px-2.5 py-1.5 align-top">
                <Copy copy={statement.copy} />
              </td>
              <td className="px-2.5 py-1.5 align-top whitespace-nowrap text-muted">
                {statement.offered ? (statement.selected ? 'yes' : 'no') : 'cannot be'}
              </td>
              <td
                className={`px-2.5 py-1.5 text-right align-top font-mono ${
                  statement.contribution > 0 ? 'text-accent' : 'text-negative'
                }`}
              >
                {statement.contribution > 0 ? '+' : ''}
                {statement.contribution}
              </td>
            </tr>
          ))}
          <tr className="border-t border-hairline-strong bg-[var(--etoro-white-08)] font-medium">
            <td className="px-2.5 py-1.5" colSpan={2}>
              Total
            </td>
            <td className="px-2.5 py-1.5 text-right font-mono">{total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * True when the summary sentence would only restate the line above it.
 *
 * One answer, scored as configured, no surprises: the answer text and the badge beside the question
 * already say everything the sentence would. It stays for every other route, because a default
 * substituted for a missing answer, a highest-of-several, or a banded total are all things you
 * cannot read off the badge.
 */
function summaryIsRedundant(leaf: LeafExplanation): boolean {
  return (
    leaf.route === 'per-answer' &&
    leaf.agrees &&
    leaf.notes.length === 0 &&
    leaf.selected.length === 1 &&
    !leaf.selected[0].usedDefault
  );
}

/**
 * One question: its wording, what the user answered, and the level that came out.
 *
 * Two lines rather than a label-value pair, because the wording is long and the answer is the part
 * being looked for. The level sits top-right on its own grid cell so a column of them lines up
 * however many lines the question wraps to.
 */
function Question({
  node,
  leaf,
  decisive,
}: {
  node: TreeNode;
  leaf: LeafExplanation | undefined;
  decisive: boolean;
}) {
  return (
    <div
      className={`grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1 border-b border-hairline py-2.5 last:border-0 ${
        decisive ? 'determinant -mx-3 rounded-md px-3' : ''
      }`}
    >
      <div className="text-[12.5px] text-muted">&ldquo;{node.title}&rdquo;</div>
      <div className="col-start-2 row-start-1">
        <RiskBadge level={node.riskLevel} />
      </div>

      <div className="col-start-1 text-[12.5px]">
        {leaf && leaf.selected.length > 0 ? (
          <>
            {leaf.selected.map((answer, index) => (
              <span key={answer.answerId}>
                {index > 0 && <span className="text-muted">; </span>}
                <span className="font-medium">
                  <Copy copy={answer.copy} />
                </span>
                {answer.copy.sub && (
                  <span className="ml-1 text-[11.5px] text-muted">({answer.copy.sub})</span>
                )}
              </span>
            ))}
            {decisive && (
              <span className="text-[11px] font-normal text-accent italic">
                {' '}
                — determines this component
              </span>
            )}
          </>
        ) : (
          <span className="text-muted">No answer on record</span>
        )}
      </div>

      {leaf?.weighted && (
        <div className="col-span-2">
          <WeightedTable statements={leaf.weighted.statements} total={leaf.weighted.total} />
        </div>
      )}

      {leaf && (!summaryIsRedundant(leaf) || !leaf.agrees) && (
        <p
          className={`col-span-2 text-[11.5px] ${leaf.agrees ? 'text-muted' : CAUTION}`}
        >
          {leaf.summary}
          {!leaf.agrees && (
            <span className="ml-1 font-medium">
              That gives {riskLevelDisplay(leaf.computed)}, but the engine stored{' '}
              {riskLevelDisplay(leaf.stored)} — trust the stored level.
            </span>
          )}
        </p>
      )}

      {leaf?.notes.map((note) => (
        <p key={note} className={`col-span-2 ${CAUTION}`}>
          {note}
        </p>
      ))}
    </div>
  );
}

function Component({
  node,
  explanation,
}: {
  node: TreeNode;
  explanation: TreeExplanation;
}) {
  const aggregation = explanation.byNodeId.get(node.id);
  const decisiveIndex = aggregation ? determinant(aggregation) : null;

  return (
    <details open className="mt-1">
      <summary className="flex items-center gap-2.5 px-3 py-2">
        <Arrow />
        <span className="text-[13px] font-medium">{node.title}</span>
        <RiskBadge level={node.riskLevel} />
        <span className={RULE}>{ruleText(aggregation, 'question', node.children.length)}</span>
      </summary>

      <div className="tree-rail-inner ml-2.5 pt-1 pr-3 pb-3 pl-6">
        {node.children.map((question, index) => (
          <Question
            key={question.id}
            node={question}
            leaf={explanation.leafByNodeId.get(question.id)}
            decisive={index === decisiveIndex}
          />
        ))}
        {aggregation && node.children.length > 1 && (
          <div className="pt-2">
            <Arithmetic aggregation={aggregation} />
          </div>
        )}
      </div>
    </details>
  );
}

function Factor({ node, explanation }: { node: TreeNode; explanation: TreeExplanation }) {
  const aggregation = explanation.byNodeId.get(node.id);

  return (
    <details open className="border-b border-hairline last-of-type:border-0">
      <summary className="flex items-center gap-2.5 px-1 py-4">
        <Arrow />
        <span className="text-sm font-semibold">{node.title}</span>
        <RiskBadge level={node.riskLevel} size="lg" />
        <span className="ml-auto shrink-0 font-mono text-[11.5px] text-muted">
          {ruleText(aggregation, 'component', node.children.length)}
          {node.revolvingDoorOrder !== null && ` · remediation order ${node.revolvingDoorOrder}`}
        </span>
      </summary>

      <div className="tree-rail ml-2.5 pr-1 pb-4 pl-6">
        {node.children.map((component) => (
          <Component key={component.id} node={component} explanation={explanation} />
        ))}
        {aggregation && node.children.length > 1 && (
          <div className="px-3 pt-3">
            <Arithmetic aggregation={aggregation} />
          </div>
        )}
      </div>
    </details>
  );
}

export function TreeView({
  tree,
  explanation,
}: {
  tree: NormalisedTree;
  explanation: TreeExplanation;
}) {
  if (tree.nodes.length === 0) {
    return <p className="text-sm text-muted">No calculation nodes were stored for this user.</p>;
  }

  const root = explanation.root;
  const decisiveFactor = root ? determinant(root) : null;

  return (
    <>
      <div
        data-tree
        className="rounded-2xl border border-hairline bg-surface px-5 pt-1.5 pb-5 shadow-[var(--shadow-card)]"
      >
        {tree.nodes.map((node) => (
          <Factor key={node.id} node={node} explanation={explanation} />
        ))}
      </div>

      {/* The bottom line, restated on its own so the answer to "what is this user capped at" does
          not depend on having scrolled the tree to the end. */}
      {root && (
        <div className="etoro-lift mt-5 flex flex-wrap items-center gap-4 rounded-2xl px-6 py-4.5">
          <span className="text-[11px] uppercase tracking-[0.06em] text-muted">Final level</span>
          <span
            className={`font-display text-[22px] font-extrabold ${
              root.stored ? RISK_INK[root.stored] : 'text-muted'
            }`}
          >
            {root.stored ? RISK_LEVEL_DISPLAY[root.stored] : 'no level'}
          </span>
          <span className="ml-auto font-mono text-[12px] text-muted">
            {root.operation.toUpperCase()}({' '}
            {root.inputs.map((input) => `${input.title}: ${riskLevelDisplay(input.level)}`).join(', ')}{' '}
            ){decisiveFactor !== null && ` → determined by ${root.inputs[decisiveFactor].title}`}
          </span>
        </div>
      )}

      <p className="mt-3 text-[11.5px] text-muted">
        {tree.counts.factor} factors · {tree.counts.component} components · {tree.counts.question}{' '}
        questions
        {explanation.byNodeId.size === 0 && ' · no configuration matched, so no arithmetic is shown'}
      </p>

      {root && !root.agrees && (
        <p className={`mt-1 ${CAUTION}`}>{root.summary} That does not match the stored level.</p>
      )}
    </>
  );
}
