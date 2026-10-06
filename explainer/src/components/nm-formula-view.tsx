import type { LoadedConfig } from '@/config/types';
import { formatAutoRelease } from '@/config/nm';
import {
  answersByQuestion,
  buildCheckNode,
  type BlockCheckGroup,
  type BlockCheckLeaf,
} from '@/domain/block-explain';

const MONO = 'font-mono text-[12.5px] text-muted';

// Config-only: the formula states the rule for anyone, so there are no answers to annotate.
const NO_ANSWERS = answersByQuestion([]);

/** Prose quantifier matching the suitability formula's "all / any of these hold" phrasing. */
function quantifier(node: BlockCheckGroup): string {
  switch (node.condition) {
    case 'All':
      return 'all';
    case 'Any':
      return node.minCount > 1 ? `at least ${node.minCount}` : 'any';
    case 'LessThan':
      return `fewer than ${node.minCount}`;
    case 'GreaterThan':
      return `more than ${node.minCount}`;
    default:
      return node.condition;
  }
}

function LeafItem({ leaf }: { leaf: BlockCheckLeaf }) {
  return (
    <li className="text-[12.5px] text-muted">
      {leaf.scored ? (
        <>
          {leaf.questionLabel}{' '}
          <span className="italic">— scored assessment (answers are summed and banded)</span>
        </>
      ) : (
        <>
          {leaf.questionLabel} is{' '}
          {leaf.condition === 'All' && leaf.blocksOn.length > 1 && (
            <span className="text-muted">all of </span>
          )}
          <strong className="font-medium text-ink">
            {leaf.blocksOn.map((a) => a.text).join(leaf.condition === 'All' ? ' and ' : ' or ')}
          </strong>
          {leaf.excludeAnswers.length > 0 && (
            <span> (unless {leaf.excludeAnswers.map((a) => a.text).join(' or ')})</span>
          )}
        </>
      )}
    </li>
  );
}

function GroupBlock({ node }: { node: BlockCheckGroup }) {
  const verb =
    node.result === 'NotBlocked' ? 'Released' : node.result === 'Blocked' ? 'Blocked' : node.result;

  return (
    <div>
      <p className="mb-2 text-[12.5px]">
        {verb} when <strong>{quantifier(node)}</strong> of these hold:
      </p>
      <ul className="space-y-1">
        {node.children.map((child, i) =>
          child.kind === 'leaf' ? (
            <LeafItem key={i} leaf={child} />
          ) : (
            <li key={i} className="mt-1.5 border-l border-hairline pl-3">
              <GroupBlock node={child} />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function NmFormulaView({
  config,
  selectedKey,
}: {
  config: LoadedConfig;
  /** Product currently shown in the breakdown above — that drawer starts open, the rest closed. */
  selectedKey?: string;
}) {
  const products = config.negativeMarketProducts;
  if (products.length === 0) {
    return <p className="text-sm text-muted">No Negative Market products in {config.id}.</p>;
  }

  const openKey =
    selectedKey && products.some((p) => p.storedKey === selectedKey)
      ? selectedKey
      : products[0].storedKey;

  return (
    <div className="space-y-3">
      {products.map((product) => (
        <details
          key={product.configKey}
          className="group rounded-xl border border-hairline px-4 py-3"
          open={product.storedKey === openKey}
        >
          <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <span className="sx-arrow text-muted" aria-hidden>
                ▸
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
                {product.label}
              </span>
            </span>
            <span className={MONO}>
              {product.configKey} · Default: {product.config.DefaultResult || '(none)'}
            </span>
          </summary>
          <div className="mt-4 space-y-5 pl-6">
            {(product.config.Rules ?? []).map((rule) => {
              const nodes = (rule.Checks ?? []).map((check) => buildCheckNode(check, NO_ANSWERS));
              const autoRelease = rule.HasAutoRelease ? formatAutoRelease(rule) : null;
              return (
                <div key={rule.Name}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5">
                    <span className="text-[13px] font-semibold">{rule.Name}</span>
                    <span className={MONO}>
                      {autoRelease ? `Auto-release: ${autoRelease}` : 'no auto-release'}
                    </span>
                  </div>
                  {nodes.length > 0 ? (
                    <div className="space-y-3">
                      {nodes.map((node, i) => (
                        <GroupBlock key={i} node={node} />
                      ))}
                    </div>
                  ) : (
                    <p className={MONO}>No predicate on this rule.</p>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      ))}
      <p className="text-[11.5px] text-muted">
        Predicates are read from the configuration document. This view does not replay them —
        compare against the stored rule results above.
      </p>
    </div>
  );
}
