/**
 * Collapsible reference section — shared across profile tabs.
 */
export function ProfileCollapsible({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="rounded-2xl border border-hairline bg-surface px-6 py-4.5 shadow-[var(--shadow-card)]">
      <summary className="flex items-baseline gap-2.5">
        <span className="sx-arrow" aria-hidden>
          ▸
        </span>
        <span className="text-base font-semibold">{title}</span>
      </summary>
      {subtitle && <p className="mt-1 mb-5 pl-6 text-[12.5px] text-muted">{subtitle}</p>}
      <div className="pl-6">{children}</div>
    </details>
  );
}

export function ProfileSectionHead({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {subtitle && <p className="mt-1 text-[12.5px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
