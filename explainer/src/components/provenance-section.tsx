import type { Provenance } from '@/domain/outcome';

export function ProvenanceSection({ provenance }: { provenance: Provenance }) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface px-6 py-4.5 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
        Provenance
      </h2>
      <dl className="grid gap-x-6 gap-y-3 font-mono text-[12px] sm:grid-cols-3">
        {(
          [
            ['Regulation', provenance.regulation],
            ['Config version', provenance.configurationVersion],
            ['Country id', provenance.countryId],
            ['Verification level', provenance.verificationLevel],
            ['Last recalculated because', provenance.recalculationReason],
            ['Result updated', provenance.updatedOn],
            ['Last answer at', provenance.lastAnswerOccurredAt],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="mb-0.5 font-sans text-[10px] uppercase tracking-[0.04em] text-muted">
              {label}
            </dt>
            <dd>{value ?? <span className="text-muted">—</span>}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
