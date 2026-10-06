import Link from 'next/link';

export type ProfileTab = 'suitability' | 'negative-market' | 'appropriateness';

const TABS: { id: ProfileTab; label: string; future?: boolean }[] = [
  { id: 'suitability', label: 'Suitability' },
  { id: 'negative-market', label: 'Negative Market' },
  { id: 'appropriateness', label: 'Appropriateness', future: true },
];

export function parseProfileTab(value: string | undefined): ProfileTab {
  if (value === 'negative-market' || value === 'appropriateness') return value;
  return 'suitability';
}

export function profileTabHref(
  gcid: number,
  tab: ProfileTab,
  params: { via?: string; from?: number; product?: string },
): string {
  const search = new URLSearchParams();
  if (params.via) search.set('via', params.via);
  if (params.from) search.set('from', String(params.from));
  if (tab !== 'suitability') search.set('tab', tab);
  if (tab === 'negative-market' && params.product) search.set('product', params.product);
  const q = search.toString();
  return `/profile/${gcid}${q ? `?${q}` : ''}`;
}

const TAB_PILL =
  'rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors';

export function ProfileTestTabs({
  gcid,
  active,
  query,
}: {
  gcid: number;
  active: ProfileTab;
  query: { via?: string; from?: number; product?: string };
}) {
  return (
    <nav
      className="flex flex-wrap gap-2 border-b border-hairline pb-4"
      aria-label="Compliance tests"
    >
      {TABS.map((tab) => {
        const selected = active === tab.id;
        return (
          <Link
            key={tab.id}
            href={profileTabHref(gcid, tab.id, query)}
            className={`${TAB_PILL} ${
              selected
                ? 'bg-risk-low text-accent'
                : 'bg-[var(--etoro-white-08)] text-muted hover:text-ink'
            }`}
            aria-current={selected ? 'page' : undefined}
          >
            {tab.label}
            {tab.future && <span className="ml-1.5 font-normal opacity-70">(future)</span>}
          </Link>
        );
      })}
    </nav>
  );
}
