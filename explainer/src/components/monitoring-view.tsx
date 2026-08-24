import { CU_EXPRESSION, type FsustPath, type MonitoringExplanation } from '@/domain/monitoring';

/**
 * The daily solvency gate, with the sustainability limit rebuilt from this user's own answers.
 *
 * The gate has two sides and only one of them can be shown honestly. The limit is a function of
 * three answers we hold, so it gets a full breakdown; utilisation comes from the trading side and
 * gets a stored figure and a formula. Presenting them as an equal pair would imply we can check
 * both, so the layout keeps them apart: the limit is the long section, utilisation is a short one
 * that says where its numbers come from instead.
 *
 * Both sustainability paths are always drawn, not just the binding one. A user near the gate is
 * near it because one of the two came out small, and which one it was is the whole answer to "what
 * would change this".
 */

const CARD = 'rounded-xl border border-hairline';
const MONO = 'font-mono text-[12.5px]';
const LABEL = 'text-[11px] font-medium uppercase tracking-[0.05em] text-muted';

/**
 * No currency symbol.
 *
 * The profile records neither the account currency nor a currency on these figures, and stamping a
 * `$` on a number read out of Cosmos would be this app inventing a fact. The disclosure line under
 * the figures says as much.
 */
const money = (value: number): string =>
  value.toLocaleString('en-US', { maximumFractionDigits: 2 });

function Verdict({ explanation }: { explanation: MonitoringExplanation }) {
  const { verdict, headroom } = explanation;

  const [tone, headline, detail] = ((): [string, string, string] => {
    switch (verdict.kind) {
      case 'blocked':
        return [
          'text-negative',
          'Blocked from opening new copies',
          `Utilisation exceeds the limit by ${money(-(headroom ?? 0))}. Existing copies are ` +
            'untouched — the gate only stops new ones.',
        ];
      case 'within-limit':
        return [
          'text-accent',
          'Within the limit',
          headroom === null
            ? 'Utilisation is at or below the limit.'
            : `${money(headroom)} of room left before new copies are stopped.`,
        ];
      case 'manually-unblocked':
        return [
          'text-caution',
          'Manually unblocked',
          'Someone cleared this user through the back office, which forces the gate to pass ' +
            'regardless of the figures below.',
        ];
      case 'not-evaluated':
        return ['text-muted', 'Not evaluated', verdict.reason];
    }
  })();

  return (
    <div className="etoro-lift rounded-2xl px-6 py-4.5">
      <div className={`font-display text-[19px] font-extrabold ${tone}`}>{headline}</div>
      <p className="mt-1 max-w-3xl text-[12.5px] text-muted">{detail}</p>

      <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-3">
        {(
          [
            ['Copy utilisation', explanation.stored.copyUtilization],
            ['Sustainability limit', explanation.stored.financialSustainability],
            // Relabelled rather than shown as a negative: "headroom −31,250" makes the reader do
            // the sign in their head to work out which side of the gate they are on.
            headroom !== null && headroom < 0
              ? ['Over the limit by', -headroom]
              : ['Headroom', headroom],
          ] satisfies [string, number | null][]
        ).map(([label, value]) => (
          <div key={label}>
            <dt className={`${LABEL} mb-1`}>{label}</dt>
            <dd className="font-mono text-[15px] tabular-nums">
              {value === null ? <span className="text-muted">—</span> : money(value)}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-3.5 text-[11.5px] text-muted">
        Checked once a day. Copy is stopped while utilisation is strictly above the limit; equal
        passes.
      </p>
    </div>
  );
}

function Path({ path, binds }: { path: FsustPath; binds: boolean }) {
  return (
    <div className={`${CARD} ${binds ? 'border-accent/40 bg-accent/[0.04]' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-4 py-2.5">
        <span className="text-[13px] font-semibold">{path.label}</span>
        {binds && (
          <span className="rounded-full border border-accent/50 px-2 py-0.5 text-[10.5px] font-medium tracking-[0.03em] text-accent uppercase">
            sets the limit
          </span>
        )}
        <span className={`ml-auto ${MONO} tabular-nums`}>
          {path.total === null ? <span className="text-muted">cannot be computed</span> : money(path.total)}
        </span>
      </div>

      <div className="px-4 py-1">
        {path.terms.map((term) => (
          <div
            key={term.questionId}
            className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 border-b border-hairline py-2 last:border-0"
          >
            <div className="text-[12.5px] text-muted">&ldquo;{term.question}&rdquo;</div>
            <div className="col-start-2 row-start-1 text-[12.5px] font-medium">
              {term.band ?? <span className="font-normal text-muted">no answer</span>}
            </div>
            <div className={`col-span-2 ${MONO} text-muted`} title={`CCM key: ${term.weightKey}`}>
              {Math.round(term.weight * 100)}%{' × '}
              {term.answerId === null
                ? '? — nothing to price'
                : term.amount === null
                  ? '? — this band has no amount'
                  : `${money(term.amount)} = ${money(term.product as number)}`}
            </div>
          </div>
        ))}

        {path.years !== null && (
          <div className={`border-t border-hairline py-2 ${MONO} text-muted`}>
            × {path.years} {path.years === 1 ? 'year' : 'years'}
            {path.ftdYear !== null && ` — first deposit in ${path.ftdYear}`}, counting the deposit
            year itself
          </div>
        )}
      </div>

      {path.blockers.length > 0 && (
        <div className="border-t border-hairline px-4 py-2.5">
          {path.blockers.map((blocker) => (
            <p key={blocker} className="text-[11.5px] text-caution">
              {blocker}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Agreement({ explanation }: { explanation: MonitoringExplanation }) {
  const { agrees, computed, stored } = explanation;

  if (agrees === true) {
    return (
      <p className="text-[12px] text-muted">
        This arithmetic reproduces the stored limit of{' '}
        <span className="font-mono">{money(stored.financialSustainability as number)}</span>, so the
        breakdown above is the one the engine used.
      </p>
    );
  }

  if (agrees === false) {
    return (
      <p className="text-[12px] text-caution">
        This arithmetic gives <span className="font-mono">{money(computed as number)}</span> but the
        engine stored{' '}
        <span className="font-mono">{money(stored.financialSustainability as number)}</span>. Trust
        the stored figure — it is what the gate compared against.
      </p>
    );
  }

  return (
    <p className="text-[12px] text-muted">
      There is nothing to check this against
      {computed === null && stored.financialSustainability === null
        ? ': neither side of the comparison could be produced.'
        : computed === null
          ? ' — the reconstruction could not finish, for the reasons above.'
          : ': the profile holds no sustainability figure.'}
    </p>
  );
}

export function MonitoringView({ explanation }: { explanation: MonitoringExplanation }) {
  const [balanceSheet, intent] = explanation.paths;

  // Internal accounts and unverified users have none of the three answers, and drawing two empty
  // paths for them is three rows of "no answer" where one sentence says more.
  const anyAnswer = explanation.paths.some((path) =>
    path.terms.some((term) => term.answerId !== null),
  );

  return (
    <div className="space-y-6">
      <Verdict explanation={explanation} />

      <div>
        <h3 className={`${LABEL} mb-1`}>Where the limit comes from</h3>
        <p className="mb-3 text-[12.5px] text-muted">
          The lower of two readings of the same user: what their finances say they can absorb, and
          what they told us they intend to put in. Taking the smaller means a large balance sheet
          cannot override a small stated intent, or the reverse.
        </p>

        {anyAnswer ? (
          <>
            <div className="space-y-2.5">
              <Path path={balanceSheet} binds={explanation.binding === 'balance-sheet'} />
              <Path path={intent} binds={explanation.binding === 'intent'} />
            </div>
            <div className="mt-3">
              <Agreement explanation={explanation} />
            </div>
          </>
        ) : (
          <p className="text-[12.5px] text-caution">
            This profile answers none of the three questions the limit is built from — net annual
            income, liquid assets and the planned yearly deposit — so there is nothing to rebuild.
          </p>
        )}
      </div>

      <div>
        <h3 className={`${LABEL} mb-1`}>How utilisation is measured</h3>
        <p className={`${MONO} mt-2 text-muted`}>{CU_EXPRESSION}</p>
        <p className="mt-2 text-[12px] text-muted">
          Subtracting realised profit is what makes this a measure of money at risk rather than money
          committed: a user who has already taken profit out of closed copies has less of their own
          capital exposed. It cannot be broken down here — both inputs come from the trading side&rsquo;s{' '}
          <span className="font-mono">MirrorSummary</span>, which this app does not read.
        </p>
      </div>

      <div className="space-y-1.5">
        {explanation.notes.map((note) => (
          <p key={note} className="text-[11.5px] text-caution">
            {note}
          </p>
        ))}
        <p className="text-[11.5px] text-muted">
          The three weightings and the band-to-amount table are CCM keys rather than parts of the
          configuration document, so they are transcribed in this app and can fall behind
          production. Amounts are in whatever currency the account holds, which the profile does not
          record.
        </p>
      </div>
    </div>
  );
}
