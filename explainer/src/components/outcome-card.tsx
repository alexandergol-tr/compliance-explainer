import { RISK_INK } from './risk-badge';
import { RISK_LEVEL_DISPLAY } from '@/domain/ids';
import type { MonitoringState, Outcome } from '@/domain/outcome';

/**
 * The headline. Every branch below is a distinct state on purpose — see domain/outcome.ts for
 * why collapsing "not assessed" into "Minimal" is a factual error rather than a rounding.
 */

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

const LABEL = 'text-[11px] uppercase tracking-[0.06em] text-muted';

function Cell({
  label,
  divideRight,
  divideBottom,
  children,
}: {
  label: string;
  divideRight?: boolean;
  divideBottom?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`px-6 py-4.5 ${divideRight ? 'sm:border-r sm:border-hairline' : ''} ${
        divideBottom ? 'border-b border-hairline' : ''
      }`}
    >
      <div className={`${LABEL} mb-1.5`}>{label}</div>
      <div className="text-[12.5px]">{children}</div>
    </div>
  );
}

function Monitoring({ state }: { state: MonitoringState }) {
  if (state.kind === 'manually-unblocked') {
    return <Pill tone="accent">Manually unblocked</Pill>;
  }

  if (state.kind === 'not-evaluated') {
    return (
      <>
        <Pill tone="mute">Not evaluated</Pill>
        <span className="mt-1.5 block text-[11.5px] text-muted">{state.reason}</span>
      </>
    );
  }

  const money = (n: number) =>
    n.toLocaleString('en-GB', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  return (
    <>
      <Pill tone={state.kind === 'blocked' ? 'stop' : 'accent'}>
        {state.kind === 'blocked' ? 'Blocked' : 'Within limit'}
      </Pill>
      <span className="mt-1.5 block font-mono text-[11.5px] text-muted">
        CU {money(state.copyUtilization)} vs FSUST {money(state.financialSustainability)}
      </span>
    </>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: 'accent' | 'stop' | 'mute';
  children: React.ReactNode;
}) {
  const skin =
    tone === 'stop'
      ? 'bg-risk-high text-negative'
      : tone === 'accent'
        ? 'bg-risk-low text-accent'
        : 'bg-[var(--etoro-white-08)] text-muted';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${skin}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function OutcomeCard({ outcome }: { outcome: Outcome }) {
  // Each branch states the one fact that explains the absence, and stops. Nothing has been
  // calculated, scored low, and blocked are three different things, and the wording has to keep
  // them apart — that is the whole reason these are separate branches.
  if (outcome.kind === 'never-calculated') {
    return (
      <Panel tone="warn" title="No stored profile">
        <p>Nothing has been calculated for this user. This is not a low score.</p>
      </Panel>
    );
  }

  if (outcome.kind === 'not-assessed') {
    return (
      <Panel tone="warn" title="Not assessed">
        <p>
          Verification level is <strong>{outcome.verificationLevel ?? 'unknown'}</strong>, below the
          level 2 scoring requires. There is no risk level and no block — not a{' '}
          <em>Minimal</em> one.
        </p>
      </Panel>
    );
  }

  if (outcome.kind === 'internal-account') {
    return (
      <Panel tone="warn" title="Internal eToro account — scoring bypassed">
        <p>
          Country is <code className="font-mono">eToro (250)</code>, so the engine hardcodes{' '}
          <em>High / not blocked / all answered</em> and skips the formulas. Any values here are
          placeholders.
        </p>
      </Panel>
    );
  }

  if (outcome.kind === 'regulation-does-not-score') {
    return (
      <Panel tone="neutral" title={`${outcome.regulation} does not run a suitability test`}>
        <p>
          {outcome.regulation}&rsquo;s current configuration defines no suitability factors, so it
          gates copy trading by other means and there is no result to show.
        </p>
      </Panel>
    );
  }

  const blocked = outcome.hardBlocked === true;
  const level = outcome.riskLevel ? RISK_LEVEL_DISPLAY[outcome.riskLevel] : 'no level';

  return (
    <section className="grid overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)] sm:grid-cols-[260px_1fr]">
      {/* The hard block, where there is one, is the headline. A blocked user has a risk level and
          an authorised score like anyone else, but neither lets them copy anything, so leading with
          the level would answer a question nobody asked and bury the one they did.

          Only the hard block gets this treatment. A monitoring block also stops new copies, but it
          is re-evaluated daily and leaves existing copies running, so it belongs in its own cell
          rather than replacing the headline. */}
      <div
        className={`flex flex-col justify-center gap-2.5 border-b border-hairline px-6 py-7 sm:border-r sm:border-b-0 ${
          blocked ? 'bg-[var(--etoro-red-08)]' : 'etoro-lift'
        }`}
      >
        <span className={`${LABEL} tracking-[0.08em]`}>
          {blocked ? 'Copy trading' : 'Client risk level'}
        </span>
        {/* The level carries its own ramp colour rather than the mint accent: a High
            user reading as mint here would contradict every red High chip below. */}
        <span
          className={`font-display text-[40px] leading-none font-extrabold tracking-[-1px] ${
            blocked
              ? 'text-negative'
              : outcome.riskLevel
                ? RISK_INK[outcome.riskLevel]
                : 'text-muted'
          }`}
        >
          {blocked ? 'Blocked' : level}
        </span>
        <span className="text-[12.5px] text-muted">
          {blocked ? (
            <>
              Blocked from all copy activity. The stored level is{' '}
              <strong className="text-ink">{level}</strong> and the authorised score{' '}
              <strong className="text-ink">{outcome.authorizedRiskScore}</strong>, but the block
              overrides both.
            </>
          ) : (
            <>
              Authorised risk score{' '}
              <strong className="text-ink">{outcome.authorizedRiskScore}</strong> — may copy targets
              scoring {outcome.authorizedRiskScore} or below
            </>
          )}
        </span>
        {!outcome.scoreFromConfig && (
          <span className="text-[11.5px] text-caution">
            Score read from the fallback map, not this config version.
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-2">
        <Cell label="Hard block" divideRight divideBottom>
          {outcome.hardBlocked === null ? (
            <Pill tone="mute">Unknown</Pill>
          ) : blocked ? (
            <Pill tone="stop">Blocked from all copy activity</Pill>
          ) : (
            <Pill tone="accent">Not blocked</Pill>
          )}
        </Cell>

        <Cell label="All required questions answered" divideBottom>
          {outcome.isAllQuestionsAnswered === null ? (
            <Pill tone="mute">Unknown</Pill>
          ) : outcome.isAllQuestionsAnswered ? (
            <Pill tone="accent">Yes</Pill>
          ) : (
            <Pill tone="stop">No</Pill>
          )}
        </Cell>

        <Cell label="Ongoing monitoring" divideRight>
          <Monitoring state={outcome.monitoring} />
        </Cell>

        <Cell label="Configuration">
          <span className="font-mono text-[13px]">
            {outcome.provenance.regulation ?? 'unknown regulation'}
            {outcome.provenance.configurationVersion !== null &&
              ` v${outcome.provenance.configurationVersion}`}
          </span>
        </Cell>
      </div>
    </section>
  );
}
