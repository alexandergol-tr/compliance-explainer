import type { ReactNode } from 'react';
import type { BlockAnswer, BlockCheckLeaf, BlockCheckNode } from '@/domain/block-explain';

const LABEL = 'text-[11px] uppercase tracking-[0.06em] text-muted';

export function blockingIdSet(leaf: BlockCheckLeaf): Set<number> {
  return new Set(leaf.blocksOn.map((a) => a.id).filter((x): x is number => x !== null));
}

export function AnswerList({
  answers,
  highlight,
  highlightClass = 'font-semibold text-negative',
}: {
  answers: BlockAnswer[];
  highlight?: Set<number>;
  highlightClass?: string;
}) {
  if (answers.length === 0) return <span className="text-muted">—</span>;
  return (
    <>
      {answers.map((a, i) => {
        const hit = a.id !== null && highlight?.has(a.id);
        return (
          <span key={`${a.name}-${i}`}>
            {i > 0 && <span className="text-muted">, </span>}
            <span
              className={hit ? highlightClass : undefined}
              title={a.id !== null ? `${a.name} (id ${a.id})` : a.name}
            >
              {a.text}
            </span>
          </span>
        );
      })}
    </>
  );
}

/**
 * Context a leaf needs from the check it sits in. `All` groups are the reason: one matched leaf
 * inside an `All` does not satisfy the group unless every sibling matches too, so "Triggers block"
 * must not fire on a single answer while required siblings are still unanswered.
 */
interface LeafContext {
  condition: string;
  /** Every non-scored leaf in this `All` group matched — the AND is met by the answers on record. */
  siblingsAllMatched: boolean;
  /**
   * Parent is `All` with `DefaultResult: Blocked`. Only then does a missing required answer use
   * the check default. `LessThan` / `GreaterThan` treat unanswered as "not true" — not a default.
   */
  missingUsesBlockedDefault: boolean;
  /**
   * Parent check `Result` is `NotBlocked`. Listed answers are the release / passing set
   * (ASIC GAML CfdRiskAssessment), not knockouts.
   */
  releases: boolean;
}

/**
 * `blocked` is the engine's stored verdict for the rule this leaf belongs to. A leaf can sit in
 * a blocking set without the rule blocking — the engine also weighs repeat-attempt thresholds and
 * companion conditions the document does not expose per answer. So "Triggers block" is only
 * asserted when the engine blocked **and** this answer actually completes its check: inside an
 * `All` group that means every sibling matched, not just this one.
 *
 * Checks with `Result: NotBlocked` (ASIC GAML CfdRiskAssessment, inner experience releases)
 * list the passing answers. Membership there is a release, not a knockout — highlighted in
 * accent, never red.
 */
function Leaf({ leaf, blocked, context }: { leaf: BlockCheckLeaf; blocked: boolean; context?: LeafContext }) {
  const listed = blockingIdSet(leaf);
  const inAll = context?.condition === 'All';
  const completesCheck = !inAll || Boolean(context?.siblingsAllMatched);
  const releases = Boolean(context?.releases);
  const decisive = !releases && leaf.matched && blocked && completesCheck;
  const inReleaseSet = releases && leaf.matched;
  const missedRelease = releases && leaf.answered && !leaf.matched && !leaf.scored;
  const missingRequired =
    blocked &&
    !leaf.answered &&
    !leaf.scored &&
    leaf.isRequired &&
    Boolean(context?.missingUsesBlockedDefault);

  const tone = decisive
    ? 'border-[rgba(255,90,90,0.35)] bg-risk-high'
    : missedRelease || missingRequired
      ? 'border-[rgba(237,197,0,0.3)] bg-[rgba(237,197,0,0.06)]'
      : inReleaseSet
        ? 'border-[rgba(19,206,102,0.28)] bg-risk-low'
        : leaf.matched
          ? 'border-[rgba(237,197,0,0.3)] bg-[rgba(237,197,0,0.06)]'
          : 'border-hairline bg-[var(--etoro-white-04)]';

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tone}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{leaf.questionLabel}</span>
        {decisive ? (
          <span className="shrink-0 rounded-full bg-[rgba(255,90,90,0.18)] px-2 py-0.5 text-[10.5px] font-semibold text-negative">
            Triggers block
          </span>
        ) : inReleaseSet ? (
          <span className="shrink-0 rounded-full bg-risk-low px-2 py-0.5 text-[10.5px] font-semibold text-accent">
            In release set
          </span>
        ) : missedRelease ? (
          <span className="shrink-0 rounded-full bg-[rgba(237,197,0,0.16)] px-2 py-0.5 text-[10.5px] font-semibold text-caution">
            Not in release set
          </span>
        ) : leaf.matched ? (
          <span className="shrink-0 rounded-full bg-[rgba(237,197,0,0.16)] px-2 py-0.5 text-[10.5px] font-semibold text-caution">
            In blocking set
          </span>
        ) : missingRequired ? (
          <span
            className="shrink-0 rounded-full bg-[rgba(237,197,0,0.16)] px-2 py-0.5 text-[10.5px] font-semibold text-caution"
            title="Required, unanswered, and this All check defaults to Blocked — a missing answer uses that default."
          >
            Required — no answer
          </span>
        ) : leaf.answered ? (
          <span className="shrink-0 text-[10.5px] font-medium text-accent">Passes</span>
        ) : (
          <span className="shrink-0 text-[10.5px] font-medium text-muted">No answer</span>
        )}
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
        <dt className="text-muted">{leaf.scored ? 'Scored on' : releases ? 'Releases when' : 'Blocks when'}</dt>
        <dd>
          {leaf.scored ? (
            <span className="text-muted">
              A scored assessment — the answers are summed and banded, so no single answer blocks
              on its own.
            </span>
          ) : (
            <>
              {leaf.questionLabel} is{' '}
              {leaf.condition === 'All' && leaf.blocksOn.length > 1 && (
                <span className="text-muted">all of </span>
              )}
              <AnswerList answers={leaf.blocksOn} />
              {leaf.excludeAnswers.length > 0 && (
                <>
                  {' '}
                  <span className="text-muted">(unless </span>
                  <AnswerList answers={leaf.excludeAnswers} />
                  <span className="text-muted">)</span>
                </>
              )}
            </>
          )}
        </dd>

        <dt className="text-muted">User answered</dt>
        <dd>
          <AnswerList
            answers={leaf.userAnswers}
            highlight={listed}
            highlightClass={
              releases ? 'font-semibold text-accent' : 'font-semibold text-negative'
            }
          />
        </dd>
      </dl>
    </div>
  );
}

function groupHeading(node: Extract<BlockCheckNode, { kind: 'group' }>): string {
  const releases = node.result === 'NotBlocked';
  const verb = releases ? 'Released' : 'Blocks';
  switch (node.condition) {
    case 'Any':
      return node.minCount > 1
        ? `${verb} if at least ${node.minCount} of these are true`
        : `${verb} if any of these are true`;
    case 'All':
      return node.defaultResult === 'Blocked'
        ? `${verb} if all of these are true — a missing required answer uses this check's Blocked default`
        : `${verb} only if all of these are true`;
    case 'LessThan':
      return `${verb} if fewer than ${node.minCount} of these are true`;
    case 'GreaterThan':
      return `${verb} if more than ${node.minCount} of these are true`;
    default:
      return `Condition: ${node.condition}`;
  }
}

export function CheckNode({
  node,
  blocked,
  depth = 0,
  context,
}: {
  node: BlockCheckNode;
  /** The engine's stored verdict for the rule that owns this predicate. */
  blocked: boolean;
  depth?: number;
  /** Supplied by the enclosing group; only leaves read it. */
  context?: LeafContext;
}) {
  if (node.kind === 'leaf') return <Leaf leaf={node} blocked={blocked} context={context} />;

  const releases = node.result === 'NotBlocked';

  // Context for this group's direct leaf children. A scored leaf never "matches" (it is summed,
  // not membership-tested), so an `All` group holding one is never reported as fully satisfied.
  const leafChildren = node.children.filter(
    (c): c is BlockCheckLeaf => c.kind === 'leaf' && !c.scored,
  );
  const childContext: LeafContext = {
    condition: node.condition,
    siblingsAllMatched: leafChildren.length > 0 && leafChildren.every((c) => c.matched),
    missingUsesBlockedDefault:
      node.condition === 'All' && node.defaultResult === 'Blocked',
    releases,
  };

  return (
    <div className={depth > 0 ? 'rounded-lg border border-hairline p-3' : ''}>
      <div className="mb-2 flex items-center gap-2">
        <span className={LABEL}>{groupHeading(node)}</span>
        {releases && (
          <span className="rounded-full bg-risk-low px-2 py-0.5 text-[10px] font-semibold text-accent">
            release path → NotBlocked
          </span>
        )}
      </div>
      <div className="space-y-2">
        {node.children.map((child, i) => (
          <CheckNode key={i} node={child} blocked={blocked} depth={depth + 1} context={childContext} />
        ))}
      </div>
    </div>
  );
}

export function WhyBlocked({
  hits,
  because,
  empty,
}: {
  hits: BlockCheckLeaf[];
  because: string;
  empty: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[rgba(255,90,90,0.3)] bg-risk-high px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-negative">
        Why this user is blocked
      </div>
      {hits.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[13px]">
          {hits.map((leaf) => {
            const blocking = blockingIdSet(leaf);
            const matchedUser = leaf.userAnswers.filter((a) => a.id !== null && blocking.has(a.id));
            return (
              <li key={leaf.question}>
                <span className="font-semibold">{leaf.questionLabel}</span>
                {' answered '}
                <AnswerList answers={matchedUser} highlight={blocking} />
                <span className="text-muted"> — {because}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-1.5 text-[12.5px] text-muted">{empty}</div>
      )}
    </div>
  );
}
