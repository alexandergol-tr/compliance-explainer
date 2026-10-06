import Link from 'next/link';
import { loadAllConfigs } from '@/config/load';
import { activeSource, fixtureSource, TEST_USERS } from '@/sources';

const FIELD_LABEL = 'text-[11px] uppercase tracking-[0.06em] text-muted';
const FIELD =
  'rounded-xl border border-hairline-strong bg-[var(--etoro-white-08)] px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none';

export default async function HomePage() {
  // Always the fixture source, never the active one. The examples stay reachable when a real
  // source is configured, because their ids are routed by `sourceFor`.
  const [examples, configs] = await Promise.all([fixtureSource().list(), loadAllConfigs()]);
  const scoring = configs.filter((c) => c.scoresSuitability);

  return (
    <div className="max-w-4xl space-y-10">
      <section>
        <h1 className="font-display text-4xl leading-[1.1] font-extrabold tracking-[-0.5px]">
          Why is this user capped at that score?
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] text-muted">
          Enter a GCID to see that user’s suitability outcome and the calculation path behind it.
          The app renders what the engine stored — it does not recalculate, and it cannot change
          anything. CID lookup is off until identity resolution is wired.
        </p>
      </section>

      <section className="rounded-2xl border border-hairline bg-surface px-7 py-6 shadow-[var(--shadow-card)]">
        <h2 className="text-base font-semibold">Look up a user</h2>
        <form action="/lookup" method="get" className="mt-4 flex flex-wrap items-end gap-4">
          <input type="hidden" name="kind" value="gcid" />
          <label className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>GCID</span>
            <input
              name="id"
              inputMode="numeric"
              pattern="[0-9]*"
              required
              placeholder="e.g. 1001"
              className={`${FIELD} w-44 font-mono`}
            />
          </label>

          <button
            type="submit"
            className="rounded-full bg-accent px-6 py-2.5 text-[15px] font-medium text-accent-ink transition-colors hover:bg-[#84ffa0] active:scale-[0.97]"
          >
            Look up
          </button>
        </form>
        <p className="mt-4 max-w-2xl text-[12.5px] text-muted">
          Lookups are GCID-only for now. CID needs an identity map we do not have on this path yet —
          guessing from the number would put the wrong customer on screen.
        </p>
      </section>

      {TEST_USERS.length > 0 && (
        <section>
          <h2 className="text-base font-semibold">
            Test users{' '}
            <span className="font-normal text-muted">— tracked production GCIDs</span>
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Hand list in <code className="font-mono">sources/test-users.ts</code>. Resolve through
            the live source ({activeSource().label}); country is the numeric{' '}
            <code className="font-mono">CountryId</code>.
          </p>
          <div className="mt-3.5 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
            <div className="grid grid-cols-[7rem_1fr_4rem] gap-4 border-b border-hairline px-5 py-2.5 text-[11px] uppercase tracking-[0.06em] text-muted">
              <span>GCID</span>
              <span>Regulation</span>
              <span>Country</span>
            </div>
            {TEST_USERS.map((u) => (
              <Link
                key={u.gcid}
                href={`/profile/${u.gcid}?via=gcid&from=${u.gcid}`}
                className="grid grid-cols-[7rem_1fr_4rem] gap-4 border-b border-hairline px-5 py-3.5 last:border-0 hover:bg-[var(--etoro-white-08)] hover:no-underline"
              >
                <span className="font-mono text-[13px] text-accent">{u.gcid}</span>
                <span className="text-[13.5px] text-ink">{u.regulation}</span>
                <span className="font-mono text-[13px] text-muted">{u.country}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {examples.length > 0 && (
        <section>
          <h2 className="text-base font-semibold">
            Examples <span className="font-normal text-muted">— synthetic, safe to click</span>
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            One per state the app has to get right, and at least one per regulation that still
            scores. The awkward ones are the point.
          </p>
          <div className="mt-3.5 overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
            {examples.map((f) => (
              <Link
                key={f.gcid}
                href={`/profile/${f.gcid}`}
                className="flex gap-4 border-b border-hairline px-5 py-3.5 last:border-0 hover:bg-[var(--etoro-white-08)] hover:no-underline"
              >
                <span className="min-w-13 font-mono text-[13px] text-accent">{f.gcid}</span>
                <span className="text-[13.5px] text-ink">{f.description}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-base font-semibold">Configurations on disk</h2>
        <p className="mt-1 text-[13px] text-muted">
          Read from <code className="font-mono">../config-prod/</code> — the live documents, verbatim
          from production Cosmos. {scoring.length} of {configs.length} score suitability; the rest
          ship a suitability block with no factors.
        </p>
        <ul className="mt-3.5 flex flex-wrap gap-2.5">
          {configs.map((c) => (
            <li
              key={c.id}
              className={`rounded-full border px-4 py-2 font-mono text-[13px] ${
                c.scoresSuitability
                  ? 'border-hairline-strong text-ink'
                  : 'border-hairline text-muted'
              }`}
              title={c.scoresSuitability ? `${c.factors.length} factors` : 'No suitability factors'}
            >
              {c.id}
              {!c.scoresSuitability && <span className="ml-2 font-sans text-[11px]">no scoring</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
