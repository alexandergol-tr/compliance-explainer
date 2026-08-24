import { RISK_LEVEL_DISPLAY, type RiskLevelName } from '@/domain/ids';

const STYLES: Record<RiskLevelName, string> = {
  // Minimal shares Low's mint hue in the design. Outlining it rather than filling
  // it keeps the two legible side by side without inventing a sixth colour.
  Minimal: 'text-risk-minimal-ink ring-1 ring-inset ring-[var(--etoro-mint-32)]',
  Low: 'bg-risk-low text-risk-low-ink',
  Medium: 'bg-risk-medium text-risk-medium-ink',
  MediumHigh: 'bg-risk-mediumhigh text-risk-mediumhigh-ink',
  High: 'bg-risk-high text-risk-high-ink',
};

/** Just the ink, for display-size type where a pill would be too small a container. */
export const RISK_INK: Record<RiskLevelName, string> = {
  Minimal: 'text-risk-minimal-ink',
  Low: 'text-risk-low-ink',
  Medium: 'text-risk-medium-ink',
  MediumHigh: 'text-risk-mediumhigh-ink',
  High: 'text-risk-high-ink',
};

/**
 * A pill carrying a level, with a leading dot in the same colour. The dot is what
 * makes the ramp scannable down a column of rows; the text is what makes it
 * unambiguous, so both are always present.
 */
export function RiskBadge({
  level,
  size = 'sm',
}: {
  level: RiskLevelName | null;
  size?: 'sm' | 'lg';
}) {
  const shape = size === 'lg' ? 'gap-1.5 px-2.5 py-1 text-xs' : 'gap-1.5 px-2.5 py-0.5 text-[11.5px]';
  const dot = size === 'lg' ? 'size-1.5' : 'size-[5px]';

  const style = level
    ? STYLES[level]
    : 'bg-[var(--etoro-white-08)] text-muted';

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full font-semibold whitespace-nowrap ${style} ${shape}`}
    >
      <span className={`${dot} rounded-full bg-current`} aria-hidden />
      {level ? RISK_LEVEL_DISPLAY[level] : 'no level'}
    </span>
  );
}
