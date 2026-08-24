import { RiskBadge } from './risk-badge';
import type { Formula } from '@/domain/formula';
import { riskLevelDisplay, type RiskLevelName } from '@/domain/ids';

/**
 * The regulation's rules, as opposed to this user's arithmetic.
 *
 * Laid out as assignments so the symbols in one line resolve in the lines beneath it, which is how
 * the engine composes them. Every value shown is read from the configuration document, so a
 * regulation that retunes anything shows the new rule here without a code change.
 */

const HEADING =
  'mb-2.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted';
const MONO = 'font-mono text-[12.5px] text-muted';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-1 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** Indent carries the nesting: root flush, factors one step in, components two. */
const INDENT: Readonly<Record<Formula['lines'][number]['level'], string>> = {
  root: 'pl-4',
  factor: 'pl-8',
  component: 'pl-12',
};

function Scoring({ formula }: { formula: Formula }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline">
      {formula.lines.map((line) => (
        <div
          key={line.symbol}
          className={`grid gap-x-4 border-b border-hairline py-2.5 pr-4 last:border-0 sm:grid-cols-[17rem_1fr] ${
            INDENT[line.level]
          }`}
        >
          <div className={line.level === 'component' ? 'text-[12.5px]' : 'text-[13px] font-semibold'}>
            {line.level === 'component' ? (
              <>
                <span className="mr-1.5 font-mono text-muted">{line.symbol}</span>
                {line.name}
              </>
            ) : (
              line.symbol
            )}
          </div>
          <div className={MONO}>
            = {line.expression}
            {line.qualifiers.length > 0 && (
              <span className="font-sans italic"> {line.qualifiers.join(' · ')}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Scale({ weights }: { weights: { level: string; weight: number }[] }) {
  return (
    <span className="font-mono text-[12.5px]">
      {weights.map((w, index) => (
        <span key={w.level}>
          {index > 0 && <span className="text-muted"> · </span>}
          {riskLevelDisplay(w.level as RiskLevelName)} {w.weight}
        </span>
      ))}
    </span>
  );
}

function Block({ formula }: { formula: Formula }) {
  if (formula.blocks.length === 0) {
    return <p className="text-[12.5px] text-muted">This configuration defines no hard block.</p>;
  }

  return (
    <div className="space-y-3">
      {formula.blocks.map((rule, index) => (
        <div key={index}>
          <p className="mb-2 text-[12.5px]">
            {rule.result === 'Blocked' ? 'Blocked from all copy activity' : rule.result} when{' '}
            <strong>{rule.combinator === 'All' ? 'all' : 'any'}</strong> of these hold:
          </p>
          <ul className="space-y-1">
            {rule.conditions.map((condition) => (
              <li key={condition.question} className="text-[12.5px] text-muted">
                {condition.question} is{' '}
                <strong className="font-medium text-ink">{condition.answers.join(' or ')}</strong>
              </li>
            ))}
          </ul>
          {rule.unreachableFallback && (
            <p className="mt-2 text-[11.5px] text-caution">
              This check declares a fallback of {rule.unreachableFallback}, which the engine never
              reads — on fall-through it applies the block&rsquo;s own {formula.blockFallback}.
            </p>
          )}
        </div>
      ))}
      <p className="text-[11.5px] text-muted">
        Otherwise {formula.blockFallback === 'NotBlocked' ? 'not blocked' : formula.blockFallback}.
        An unanswered question cannot satisfy a condition, so a missing answer leaves the user
        unblocked.
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className={HEADING}>{title}</h3>
      {children}
    </div>
  );
}

export function FormulaView({ formula }: { formula: Formula }) {
  return (
    <div className="space-y-6">
      <Group title="Scoring">
        <Scoring formula={formula} />
      </Group>

      <Group title="Weights">
        <Row label="Levels">
          <Scale weights={formula.weights} />
        </Row>
        {formula.componentScales.map((scale) => (
          <Row key={scale.symbol} label={`${scale.symbol} instead uses`}>
            <Scale weights={scale.weights} />
          </Row>
        ))}
        {formula.defaultRiskLevel && (
          <Row label="Default level">
            <RiskBadge level={formula.defaultRiskLevel as RiskLevelName} />
          </Row>
        )}
      </Group>

      <Group title="Authorised risk score">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
          {formula.scores.map((mapping) => (
            <span key={mapping.level}>
              <span className="text-muted">
                {riskLevelDisplay(mapping.level as RiskLevelName)} →{' '}
              </span>
              <span className="font-mono tabular-nums">{mapping.score}</span>
            </span>
          ))}
        </div>
      </Group>

      {/* Ongoing monitoring used to be described here, which put a rule that is not in this document
          inside a section titled after it. It now has its own section, above, where it can be shown
          against the user's own numbers instead of as a formula. */}
      <Group title="Hard block">
        <Block formula={formula} />
      </Group>
    </div>
  );
}
