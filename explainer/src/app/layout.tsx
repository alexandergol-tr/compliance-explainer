import type { Metadata } from 'next';
import Link from 'next/link';
import { activeSource } from '@/sources';
import './globals.css';

export const metadata: Metadata = {
  title: 'Suitability Explainer',
  description: 'How a user’s suitability result was calculated — internal, read-only.',
};

const PILL =
  'rounded-full px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em]';

export default function RootLayout({ children }: LayoutProps<'/'>) {
  const source = activeSource();

  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {/* Full-bleed, unlike the content column: the bar is chrome, and letting it run to the
            edges is what keeps the "real customer data" flag in the corner of your eye. */}
        <header className="border-b border-hairline bg-surface">
          <div className="flex items-center gap-3 px-8 py-3.5">
            <Link href="/" className="font-semibold tracking-[0.01em] text-ink hover:no-underline">
              Suitability Explainer
            </Link>
            <span className={`${PILL} bg-[var(--etoro-white-08)] text-muted`}>
              Read-only · Internal
            </span>
            {/* Always visible: whether what you are looking at is real is not a detail. */}
            <span
              className={`${PILL} ml-auto ${
                source.isRealData ? 'bg-risk-high text-negative' : 'bg-risk-low text-accent'
              }`}
            >
              {source.isRealData ? 'Real customer data' : 'Synthetic data'}
            </span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-8">{children}</main>

        <footer className="border-t border-hairline bg-surface">
          <div className="px-8 py-3.5 text-[11.5px] text-muted">
            Source: {source.label}. Reads only — this app cannot recalculate a profile or change a
            configuration.
          </div>
        </footer>
      </body>
    </html>
  );
}
