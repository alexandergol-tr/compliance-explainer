import type { BlockCheckNode } from '@/domain/block-explain';
import { decisiveLeaves } from '@/domain/block-explain';
import { CheckNode, WhyBlocked } from './block-checks';

/**
 * This user's copy hard-block, annotated with their answers.
 *
 * Distinct from the Formula section, which states the regulation's rule for anyone. The stored
 * `suitabilityBlock` is the verdict; this panel only shows which recorded answers sit in the
 * blocking set.
 */
export function HardBlockView({
  checks,
  storedBlocked,
}: {
  checks: BlockCheckNode[];
  storedBlocked: boolean | null;
}) {
  if (checks.length === 0) return null;

  const hits = storedBlocked === true ? decisiveLeaves(checks) : [];

  return (
    <section className="rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div className="border-b border-hairline px-6 py-4">
        <h3 className="text-[15px] font-semibold">Copy hard block</h3>
        <p className="mt-1 text-[12.5px] text-muted">
          Predicates from the configuration, annotated with this user&rsquo;s answers. The stored
          block result is not recomputed here.
        </p>
      </div>
      <div className="space-y-4 px-6 py-4">
        {storedBlocked === true && (
          <WhyBlocked
            hits={hits}
            because="a copy hard-block answer"
            empty={
              <>
                Stored result is <span className="font-mono text-ink">Blocked</span>. The answers
                on record do not map to a simple knockout in this configuration — the profile may
                have been calculated on a different config version. See the breakdown below.
              </>
            }
          />
        )}
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2.5">
            <span className="sx-arrow text-muted" aria-hidden>
              ▸
            </span>
            <span className="text-[13px] font-semibold">Predicate breakdown</span>
          </summary>
          <div className="mt-3 space-y-2 pl-6">
            {checks.map((node, i) => (
              <CheckNode key={i} node={node} blocked={storedBlocked === true} />
            ))}
          </div>
        </details>
      </div>
    </section>
  );
}
