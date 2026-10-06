import type { NmOutcome, NmProductView } from '@/domain/negative-market';

const LABEL = 'text-[11px] uppercase tracking-[0.06em] text-muted';

function Pill({ result }: { result: NmProductView['result'] }) {
  if (result === 'Unknown') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--etoro-white-08)] px-2.5 py-1 text-[12px] font-semibold text-muted">
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        No stored result
      </span>
    );
  }

  const blocked = result === 'Blocked';
  const skin = blocked ? 'bg-risk-high text-negative' : 'bg-risk-low text-accent';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${skin}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {blocked ? 'Blocked' : result === 'Warning' ? 'Warning' : 'Not blocked'}
    </span>
  );
}

function ProductCell({ product }: { product: NmProductView }) {
  return (
    <div className="px-4 py-4 sm:border-r sm:border-hairline">
      <div className={`${LABEL} mb-1.5`}>{product.shortLabel}</div>
      <Pill result={product.result} />
    </div>
  );
}

function Panel({
  tone,
  title,
  children,
}: {
  tone: 'neutral' | 'warn' | 'stop';
  title: string;
  children?: React.ReactNode;
}) {
  const skin =
    tone === 'stop'
      ? 'border-[var(--etoro-red-24)] bg-[var(--etoro-red-08)]'
      : tone === 'warn'
        ? 'border-[rgba(237,197,0,0.24)] bg-[rgba(237,197,0,0.08)]'
        : 'border-hairline bg-surface';

  return (
    <section className={`rounded-2xl border p-6 ${skin}`}>
      <h2 className="font-display text-2xl font-extrabold tracking-[-0.5px]">{title}</h2>
      {children && <div className="mt-3 space-y-3 text-[13px] leading-relaxed">{children}</div>}
    </section>
  );
}

export function NmOutcomeCard({ outcome }: { outcome: NmOutcome }) {
  if (outcome.kind === 'never-calculated') {
    return (
      <Panel tone="warn" title="No stored profile">
        <p>Nothing has been calculated for this user.</p>
      </Panel>
    );
  }

  if (outcome.kind === 'no-config') {
    return (
      <Panel tone="neutral" title="No Negative Market on this regulation">
        <p>
          {outcome.regulation ?? 'This regulation'} defines no Negative Market products in the
          loaded configuration, and the profile carries no stored product results.
        </p>
      </Panel>
    );
  }

  const blocked = outcome.products.filter((p) => p.result === 'Blocked');
  const anyBlocked = blocked.length > 0;
  const headline = anyBlocked
    ? `${blocked.length} product${blocked.length === 1 ? '' : 's'} blocked`
    : 'All products clear';

  return (
    <section className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
      <div
        className={`flex flex-col justify-center gap-2 border-b border-hairline px-6 py-6 sm:border-r-0 ${
          anyBlocked ? 'bg-[var(--etoro-red-08)]' : 'etoro-lift'
        }`}
      >
        <span className={`${LABEL} tracking-[0.08em]`}>Negative Market</span>
        <span
          className={`font-display text-[32px] leading-none font-extrabold tracking-[-0.5px] ${
            anyBlocked ? 'text-negative' : 'text-accent'
          }`}
        >
          {headline}
        </span>
        <span className="text-[12.5px] text-muted">
          Per-product knockout — independent from copy suitability. Stored results only; not
          recomputed here.
        </span>
      </div>

      <div
        className={`grid ${
          outcome.products.length <= 2
            ? 'sm:grid-cols-2'
            : outcome.products.length === 3
              ? 'sm:grid-cols-3'
              : 'sm:grid-cols-2 lg:grid-cols-4'
        }`}
      >
        {outcome.products.map((product) => (
          <ProductCell key={product.storedKey} product={product} />
        ))}
      </div>
    </section>
  );
}
