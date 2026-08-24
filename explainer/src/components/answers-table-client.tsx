'use client';

import { useMemo, useState } from 'react';
import type { Coverage } from '@/domain/coverage';

export interface AnswerRow {
  key: string;
  questionId: number;
  question: string;
  answerId: number;
  answer: string;
  /** Wording rebuilt from an internal identifier rather than shown to the customer. */
  reconstructed: boolean;
  /** Every role this answer plays, most significant first. */
  roles: Coverage[];
  coverageLabel: string;
}

/**
 * Filtering and search over the answers, which is the only interactive part of a profile.
 *
 * A verified user under CySEC has around thirty answers and two thirds of them are not used by
 * suitability at all, so "which of these actually mattered" is a question worth one click. Filters
 * are built from the rows present rather than a fixed list, so a status with no rows does not offer
 * a button that shows nothing.
 */

const TONE: Readonly<Record<Coverage, string>> = {
  scored: 'text-accent',
  'unscored-answer': 'text-caution',
  'block-input': 'text-negative',
  'monitoring-input': 'text-muted',
  'not-used': 'text-muted',
  unknown: 'text-muted',
};

const SHORT: Readonly<Record<Coverage, string>> = {
  scored: 'Scored',
  'unscored-answer': 'Not scored',
  'block-input': 'Hard-block input',
  'monitoring-input': 'Monitoring input',
  'not-used': 'Not used',
  unknown: 'Unknown',
};

const ORDER: Coverage[] = [
  'scored',
  'unscored-answer',
  'block-input',
  'monitoring-input',
  'not-used',
  'unknown',
];

const CELL = 'border-b border-hairline px-3.5 py-2.5 align-top';
const HEAD =
  'border-b border-hairline bg-[var(--etoro-white-08)] px-3.5 py-2.5 text-left font-mono text-[10.5px] font-medium uppercase tracking-[0.05em] whitespace-nowrap text-muted';

export function AnswersTableClient({ rows }: { rows: AnswerRow[] }) {
  const [status, setStatus] = useState<Coverage | 'all'>('all');
  const [search, setSearch] = useState('');

  // Tallied per role, so a row with two jobs is counted under both. The totals therefore exceed
  // the row count, which is the honest reading of "how many answers feed the hard block".
  const counts = useMemo(() => {
    const tally = new Map<Coverage, number>();
    for (const row of rows) {
      for (const role of row.roles) tally.set(role, (tally.get(role) ?? 0) + 1);
    }
    return ORDER.filter((coverage) => tally.has(coverage)).map((coverage) => ({
      coverage,
      count: tally.get(coverage) as number,
    }));
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== 'all' && !row.roles.includes(status)) return false;
      if (!needle) return true;
      return (
        row.question.toLowerCase().includes(needle) ||
        row.answer.toLowerCase().includes(needle) ||
        `q${row.questionId}`.includes(needle) ||
        `a${row.answerId}`.includes(needle)
      );
    });
  }, [rows, status, search]);

  return (
    <div>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by question or answer…"
          aria-label="Filter answers"
          className="min-w-60 rounded-full border border-hairline-strong bg-[var(--etoro-white-08)] px-4 py-2 text-[13px] text-ink placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <Chip active={status === 'all'} onClick={() => setStatus('all')}>
          All · {rows.length}
        </Chip>
        {counts.map(({ coverage, count }) => (
          <Chip
            key={coverage}
            active={status === coverage}
            onClick={() => setStatus(coverage)}
          >
            {SHORT[coverage]} · {count}
          </Chip>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-[var(--shadow-card)]">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={HEAD}>Question</th>
              <th className={HEAD}>Answer</th>
              <th className={HEAD}>How it is used</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              // Repeat the question only when it changes, computed after filtering so a row is
              // never left pointing at a question that the filter removed.
              const repeated = index > 0 && visible[index - 1].questionId === row.questionId;

              return (
                <tr key={row.key} className="last:[&>td]:border-b-0">
                  <td className={CELL}>
                    {repeated ? (
                      <span className="text-muted">↳ also</span>
                    ) : (
                      <>
                        {row.question}
                        <span className="ml-2 font-mono text-[10.5px] text-muted">
                          q{row.questionId}
                        </span>
                      </>
                    )}
                  </td>
                  <td className={CELL}>
                    {/* Italic where the wording is reconstructed from an identifier rather than
                        shown to the customer. See the Copy component in tree-view for why. */}
                    <span
                      className={row.reconstructed ? 'italic' : undefined}
                      title={
                        row.reconstructed
                          ? 'Reconstructed from the internal identifier — no customer-facing wording is available for this option.'
                          : undefined
                      }
                    >
                      {row.answer}
                    </span>
                    <span className="ml-2 font-mono text-[10.5px] text-muted">a{row.answerId}</span>
                  </td>
                  <td className={CELL}>
                    <span
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] ${
                        TONE[row.roles[0]]
                      }`}
                    >
                      <span className="size-1.5 rounded-full bg-current" aria-hidden />
                      {row.coverageLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-3.5 py-6 text-center text-[13px] text-muted">
            No answers match this filter.
          </p>
        )}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors ${
        active
          ? 'border-accent bg-accent text-accent-ink'
          : 'border-hairline-strong text-muted hover:bg-[var(--etoro-white-08)] hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
