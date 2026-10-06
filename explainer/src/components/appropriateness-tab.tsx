import type { Provenance } from '@/domain/outcome';
import { ProvenanceSection } from './provenance-section';
import { ProfileCollapsible } from './profile-section';

export function AppropriatenessTab({ provenance }: { provenance: Provenance }) {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-hairline bg-surface p-6 shadow-[var(--shadow-card)]">
        <h2 className="font-display text-2xl font-extrabold tracking-[-0.5px]">Not modelled yet</h2>
        <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-muted">
          Product appropriateness is a third test, separate from copy suitability and Negative
          Market. This tab reserves the same page hierarchy for when the rules are researched.
        </p>
      </section>

      <ProfileCollapsible title="Formula" subtitle="Will show appropriateness configuration when available.">
        <p className="text-sm text-muted">Out of scope until researched.</p>
      </ProfileCollapsible>

      <ProfileCollapsible
        title="Questions and answers by id"
        subtitle="Will list answers that feed appropriateness only."
      >
        <p className="text-sm text-muted">Out of scope until researched.</p>
      </ProfileCollapsible>

      <ProvenanceSection provenance={provenance} />
    </div>
  );
}
