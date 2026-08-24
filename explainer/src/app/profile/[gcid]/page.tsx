import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnswersTable } from '@/components/answers-table';
import { FormulaView } from '@/components/formula-view';
import { MonitoringView } from '@/components/monitoring-view';
import { OutcomeCard } from '@/components/outcome-card';
import { TreeControls } from '@/components/tree-controls';
import { TreeView } from '@/components/tree-view';
import { Warnings } from '@/components/warnings';
import { loadConfigFor } from '@/config/load';
import { explainTree } from '@/domain/arithmetic';
import { assumesCurrency, CopySnapshot } from '@/domain/copy';
import { buildCoverageIndex } from '@/domain/coverage';
import { deriveFormula } from '@/domain/formula';
import { riskLevelName } from '@/domain/ids';
import { explainMonitoring } from '@/domain/monitoring';
import { deriveMonitoring, deriveOutcome } from '@/domain/outcome';
import { normaliseTree } from '@/domain/tree';
import { activeSource, sourceFor } from '@/sources';
import {
  CosmosNotConfigured,
  CosmosQueryError,
  describeCosmosFailure,
} from '@/sources/cosmos/read-only-client';

/**
 * The `GCID nnn` line and its way out, shared by the failure and success paths.
 *
 * It states how this GCID was arrived at, because the two routes are not equally trustworthy and
 * the page is otherwise silent about the difference. A GCID typed straight in involved no
 * translation; one resolved from a CID passed through the identity map, and given that the same
 * number is usually valid in more than one space, "which number did I actually type" is the first
 * thing to check when a profile looks like the wrong person.
 */
function LookupRow({ gcid, via, from }: { gcid: number; via?: string; from?: number }) {
  const provenance =
    via === 'cid' && from
      ? `resolved from real CID ${from}`
      : via === 'gcid'
        ? 'entered as a GCID'
        : null;

  return (
    <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-mono text-xl font-semibold">GCID {gcid}</h1>
        {provenance && <span className="text-[12.5px] text-muted">{provenance}</span>}
      </div>
      <Link href="/" className="text-sm font-medium">
        New lookup →
      </Link>
    </div>
  );
}

function SourceFailure({ gcid, title, detail }: { gcid: number; title: string; detail: string }) {
  return (
    <div>
      <LookupRow gcid={gcid} />
      <div className="rounded-2xl border border-[rgba(237,197,0,0.24)] bg-[rgba(237,197,0,0.08)] p-6">
        <h2 className="font-display text-xl font-extrabold text-caution">{title}</h2>
        <p className="mt-2 max-w-3xl text-[13px]">{detail}</p>
        <p className="mt-3 text-[13px]">
          This says nothing about the user — the lookup never happened. The synthetic{' '}
          <Link href="/">worked examples</Link> still work, since they need no network access.
        </p>
      </div>
    </div>
  );
}

/** A heading above a card, optionally with controls on the right. */
function SectionHead({
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

/**
 * A card that opens and closes, for the reference material at the bottom of the page.
 *
 * Always starts closed. An earlier version opened the monitoring card whenever monitoring was the
 * thing blocking the user, which sounds helpful and is not: the verdict is already in the outcome
 * card at the top, so all the auto-open did was push the other two sections off the screen for the
 * users whose page was busiest.
 *
 * `details` rather than a state hook: this page is a server component, and collapsing a section is
 * not worth shipping a client bundle for. Keyboard toggling, the open/closed announcement and
 * in-page find all come from the element itself.
 */
function Collapsible({
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

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ gcid: string }>;
  searchParams: Promise<{ via?: string; from?: string }>;
}) {
  const [{ gcid: rawGcid }, { via, from: rawFrom }] = await Promise.all([params, searchParams]);
  const gcid = Number(rawGcid);
  if (!Number.isInteger(gcid) || gcid <= 0) notFound();

  const from = Number(rawFrom);
  const lookedUpAs = { via, from: Number.isInteger(from) && from > 0 ? from : undefined };

  const source = sourceFor(gcid);

  // Only source-level failures are caught, and only to say what went wrong. Anything else is a
  // bug and should keep crashing loudly — an app that swallows its own exceptions and renders an
  // empty profile is indistinguishable from one reporting that a customer has no data.
  let profile;
  try {
    profile = await source.getProfile(gcid);
  } catch (error) {
    if (error instanceof CosmosQueryError) {
      const { title, detail } = describeCosmosFailure(error);
      return <SourceFailure gcid={gcid} title={title} detail={detail} />;
    }
    if (error instanceof CosmosNotConfigured) {
      return (
        <SourceFailure
          gcid={gcid}
          title="The Cosmos source is not configured"
          detail={error.message}
        />
      );
    }
    throw error;
  }

  // The config that produced the result, not the current one — configs change, and comparing a
  // result against a newer config manufactures disagreements that were never there.
  const { config, exact } = await loadConfigFor(
    typeof profile?.regulation === 'string' ? profile.regulation : null,
    profile?.configurationVersion ?? null,
  );

  const answers = profile?.questionsAnswers ?? [];
  const formula = config ? deriveFormula(config) : null;

  const outcome = deriveOutcome(profile, config?.scoreMappings ?? null);
  // Gated on the profile carrying monitoring data rather than on the outcome, since the gate can
  // have run on a user the scoring never reached.
  const monitoring = profile ? explainMonitoring(profile, deriveMonitoring(profile)) : null;
  const tree = normaliseTree(profile?.suitability?.suitabilityCalculationDetails);
  const explanation = explainTree(
    tree.nodes,
    riskLevelName(profile?.suitability?.clientRiskLevel),
    config,
    answers,
  );

  const warnings = [...tree.warnings, ...explanation.warnings];

  // Absence has to be attributed to the right cause, and there are three of them. The source
  // may be incapable of returning a tree at all; the outcome may be one where an empty tree is
  // correct, which the outcome card already explains; or the engine scored the user and the tree
  // is genuinely missing. Only the last is a warning.
  if (!source.capabilities.tree) {
    warnings.push(
      `The active source (${source.label}) cannot return the calculation tree — it is not part of ` +
        'that contract. An empty tree below says nothing about this user.',
    );
  } else if (outcome.kind === 'assessed' && tree.nodes.length === 0) {
    warnings.push(
      'This user has a risk level but no stored calculation nodes, so there is no way to show how ' +
        'it was reached. Either the tree was never persisted or it was lost on the way here.',
    );
  }
  if (!source.capabilities.answers) {
    warnings.push(
      `The active source cannot return the user's answers either, so the answers table is empty ` +
        'regardless of what they answered.',
    );
  }

  if (profile && config && !exact) {
    warnings.push(
      `This result was produced by ${profile.regulation} v${profile.configurationVersion}, which is not ` +
        `in config-prod/. Showing ${config.id} instead, so answer-scoring details may differ from what actually ran.`,
    );
  }
  // Once, not once per money question. The caveat is about the whole page, and repeating it under
  // every amount was the single biggest source of noise on a profile.
  if (answers.some((entry) => assumesCurrency(entry.questionId))) {
    warnings.push(
      `Amounts are shown in ${CopySnapshot.assumedCurrency}. The profile does not record the ` +
        'account currency, so that is this view\u2019s assumption and not necessarily what the user saw.',
    );
  }
  if (
    profile?.lastAnswerOccurredAt &&
    profile.updatedOn &&
    profile.lastAnswerOccurredAt > profile.updatedOn
  ) {
    warnings.push(
      'The user answered something after this result was calculated, so the stored tree reflects an ' +
        'older set of answers. Any comparison against a recomputation would be meaningless until it reruns.',
    );
  }

  return (
    <div>
      <LookupRow gcid={gcid} via={lookedUpAs.via} from={lookedUpAs.from} />

      <div className="space-y-6">
        {/* The header describes the configured source. This page may not be using it, and a page
            of synthetic data under a "real customer data" header is exactly the wrong impression. */}
        {source.id !== activeSource().id && (
          <p className="rounded-xl border border-[rgba(237,197,0,0.24)] bg-[rgba(237,197,0,0.08)] px-4 py-3 text-[13px]">
            This is a worked example, not a customer. {gcid} falls in the reserved example range, so
            it is served from {source.label} regardless of what the header says.
          </p>
        )}

        <OutcomeCard outcome={outcome} />

        <Warnings items={warnings} />

        {tree.nodes.length > 0 && (
          <section>
            <SectionHead title="How it was calculated">
              <TreeControls />
            </SectionHead>
            <TreeView tree={tree} explanation={explanation} />
          </section>
        )}

        {/* Everything below the tree is reference material, and all of it stays closed. You arrive
            wanting the result, which is above; these are what you open once you have it, in the
            order you would reach for them — the rule, then the second gate that rule says nothing
            about, then the ids you need to cross-check either one. */}
        {formula && (
          <Collapsible
            title={`Formula — ${formula.regulation} v${formula.version}`}
            subtitle={
              exact
                ? 'The rules behind the result above, read from the configuration document that produced it.'
                : `The rules behind the result above, read from ${formula.id} — not the version that produced it.`
            }
          >
            <FormulaView formula={formula} />
          </Collapsible>
        )}

        {monitoring && (
          <Collapsible
            title="Ongoing monitoring"
            subtitle="A daily check that the money in copies has not outgrown what this user can sustain. Separate from the score above, and the only other thing that can stop a copy."
          >
            <MonitoringView explanation={monitoring} />
          </Collapsible>
        )}

        {answers.length > 0 && (
          <Collapsible
            title="Questions and answers by id"
            subtitle={
              config
                ? `Every answer on record with its question and answer ids, checked against ${config.id}.`
                : 'Every answer on record with its question and answer ids. No configuration loaded, so scoring coverage cannot be checked.'
            }
          >
            <AnswersTable answers={answers} coverage={buildCoverageIndex(config)} />
          </Collapsible>
        )}

        <section className="rounded-2xl border border-hairline bg-surface px-6 py-4.5 shadow-[var(--shadow-card)]">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
            Provenance
          </h2>
          <dl className="grid gap-x-6 gap-y-3 font-mono text-[12px] sm:grid-cols-3">
            {(
              [
                ['Regulation', outcome.provenance.regulation],
                ['Config version', outcome.provenance.configurationVersion],
                ['Country id', outcome.provenance.countryId],
                ['Verification level', outcome.provenance.verificationLevel],
                ['Last recalculated because', outcome.provenance.recalculationReason],
                ['Result updated', outcome.provenance.updatedOn],
                ['Last answer at', outcome.provenance.lastAnswerOccurredAt],
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
      </div>
    </div>
  );
}
