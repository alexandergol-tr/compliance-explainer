import Link from 'next/link';
import type { NmProductView } from '@/domain/negative-market';
import { decisiveLeaves } from '@/domain/negative-market';
import type { BlockCheckNode } from '@/domain/block-explain';
import { CheckNode, WhyBlocked } from './block-checks';
import { profileTabHref } from './profile-test-tabs';

/** True when a leaf in this subtree is in a knockout set — not a `Result: NotBlocked` release. */
function nodeHasKnockoutMatch(node: BlockCheckNode): boolean {
  if (node.kind === 'leaf') return node.matched;
  if (node.result === 'NotBlocked') {
    return node.children.some((c) => c.kind === 'group' && nodeHasKnockoutMatch(c));
  }
  return node.children.some((c) =>
    c.kind === 'leaf' ? c.matched : nodeHasKnockoutMatch(c),
  );
}

const LABEL = 'text-[11px] uppercase tracking-[0.06em] text-muted';

function verdictPill(result: NmProductView['rules'][number]['result']) {
  const blocked = result === 'Blocked';
  const skin = blocked
    ? 'bg-risk-high text-negative'
    : result === 'Warning'
      ? 'bg-risk-medium text-caution'
      : 'bg-risk-low text-accent';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${skin}`}>
      {result === 'Unknown' ? 'Unknown' : result}
    </span>
  );
}

function BlockedSummary({ product }: { product: NmProductView }) {
  if (product.result !== 'Blocked') return null;

  const blockingRuleView = product.rules.find((r) => r.name === product.blockingRule);
  const hits = blockingRuleView ? decisiveLeaves(blockingRuleView.checks) : [];

  return (
    <WhyBlocked
      hits={hits}
      because={`a knockout answer for ${product.blockingRule}`}
      empty={
        <>
          Stored result is <span className="font-mono text-ink">Blocked</span> by{' '}
          <span className="font-mono text-ink">{product.blockingRule ?? 'an unknown rule'}</span>.
          The answers on record do not map to a simple knockout in this configuration — the rule may
          be scored, or the profile was calculated on a different config version. See the rule
          breakdown below.
        </>
      }
    />
  );
}

export function NmRulesView({
  gcid,
  products,
  selectedKey,
  query,
}: {
  gcid: number;
  products: NmProductView[];
  selectedKey: string;
  query: { via?: string; from?: number };
}) {
  const selected = products.find((p) => p.storedKey === selectedKey) ?? products[0];
  if (!selected) {
    return <p className="text-sm text-muted">No Negative Market products on this profile.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {products.map((product) => {
          const active = product.storedKey === selected.storedKey;
          return (
            <Link
              key={product.storedKey}
              href={profileTabHref(gcid, 'negative-market', {
                ...query,
                product: product.storedKey,
              })}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                active
                  ? 'bg-risk-low text-accent'
                  : 'bg-[var(--etoro-white-08)] text-muted hover:text-ink'
              }`}
              aria-current={active ? 'true' : undefined}
            >
              {product.shortLabel}
            </Link>
          );
        })}
      </div>

      <div className="rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
        <div className="border-b border-hairline px-6 py-4">
          <div className={`${LABEL} mb-1`}>{selected.shortLabel}</div>
          <h3 className="text-[15px] font-semibold">{selected.label}</h3>
          <p className="mt-1 text-[12.5px] text-muted">
            Stored: <span className="font-mono">{selected.result}</span>
            {selected.blockingRule && selected.result === 'Blocked' && (
              <>
                {' '}
                — active rule <span className="font-mono">{selected.blockingRule}</span>
              </>
            )}
          </p>
        </div>

        {selected.result === 'Blocked' && (
          <div className="border-b border-hairline px-6 py-4">
            <BlockedSummary product={selected} />
          </div>
        )}

        <div className="divide-y divide-hairline">
          {selected.rules.map((rule) => (
            <details key={rule.name} className="group px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span className="sx-arrow text-muted" aria-hidden>
                    ▸
                  </span>
                  <span className="font-mono text-[13px] font-semibold">{rule.name}</span>
                </span>
                {verdictPill(rule.result)}
              </summary>
              <div className="mt-3 space-y-3 pl-6 text-[12.5px]">
                <p className="text-muted">
                  Rule result: <span className="font-mono text-ink">{rule.result}</span>
                  {' · '}
                  Check result: <span className="font-mono text-ink">{rule.checkResult}</span>
                </p>
                {rule.autoRelease && (
                  <p className="text-caution">
                    Auto-release when {rule.autoRelease}. Requires FTD date and closed-trade count
                    from trading — not in the KYC document alone.
                  </p>
                )}

                {rule.checks.length > 0 ? (
                  <div className="space-y-2">
                    {rule.result !== 'Blocked' &&
                      rule.checks.some((n) => nodeHasKnockoutMatch(n)) && (
                        <p className="rounded-lg bg-[rgba(237,197,0,0.08)] px-3 py-2 text-[12px] text-caution">
                          Some answers fall in this rule&rsquo;s blocking set, but the engine result
                          is <span className="font-mono">{rule.result}</span>. A knockout also
                          depends on repeat-attempt thresholds and companion answers that are not
                          shown per question, so a single matching answer does not block on its own.
                        </p>
                      )}
                    {rule.checks.map((node, i) => (
                      <CheckNode key={i} node={node} blocked={rule.result === 'Blocked'} />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted">
                    No predicate is loaded for this rule (it is not on the current configuration
                    document), so only the stored result is available.
                  </p>
                )}

                {rule.attempts.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[12px] text-muted">
                      Attempt history
                    </summary>
                    <table className="mt-2 w-full text-left text-[12px]">
                      <thead>
                        <tr className="text-muted">
                          <th className="pb-2 pr-4 font-medium">Question</th>
                          <th className="pb-2 pr-4 font-medium">Attempts</th>
                          <th className="pb-2 font-medium">Last attempt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rule.attempts.map((attempt) => (
                          <tr key={attempt.question} className="border-t border-hairline">
                            <td className="py-2 pr-4 font-mono">{attempt.question}</td>
                            <td className="py-2 pr-4">{attempt.attemptsTaken ?? '—'}</td>
                            <td className="py-2 font-mono text-muted">
                              {attempt.lastAttempt?.slice(0, 10) ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
