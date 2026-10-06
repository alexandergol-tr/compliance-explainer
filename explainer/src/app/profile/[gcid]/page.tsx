import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AnswersTable } from '@/components/answers-table';
import { AppropriatenessTab } from '@/components/appropriateness-tab';
import { HardBlockView } from '@/components/hard-block-view';
import { FormulaView } from '@/components/formula-view';
import { MonitoringView } from '@/components/monitoring-view';
import { NmFormulaView } from '@/components/nm-formula-view';
import { NmOutcomeCard } from '@/components/nm-outcome-card';
import { NmRulesView } from '@/components/nm-rules-view';
import { OutcomeCard } from '@/components/outcome-card';
import { ProfileCollapsible, ProfileSectionHead } from '@/components/profile-section';
import {
  parseProfileTab,
  ProfileTestTabs,
} from '@/components/profile-test-tabs';
import { ProvenanceSection } from '@/components/provenance-section';
import { TreeControls } from '@/components/tree-controls';
import { TreeView } from '@/components/tree-view';
import { Warnings } from '@/components/warnings';
import { loadConfigFor } from '@/config/load';
import { explainTree } from '@/domain/arithmetic';
import { assumesCurrency, CopySnapshot } from '@/domain/copy';
import { explainHardBlock } from '@/domain/block-explain';
import { buildCoverageIndex } from '@/domain/coverage';
import { deriveFormula } from '@/domain/formula';
import { riskLevelName } from '@/domain/ids';
import { buildNmCoverageIndex, nmCoverageLabel } from '@/domain/nm-coverage';
import { deriveNmOutcome } from '@/domain/negative-market';
import { explainMonitoring } from '@/domain/monitoring';
import { deriveMonitoring, deriveOutcome, type Provenance } from '@/domain/outcome';
import { normaliseTree } from '@/domain/tree';
import { activeSource, sourceFor } from '@/sources';
import type { RawQuestionAnswers } from '@/sources/types';
import {
  CosmosNotConfigured,
  CosmosQueryError,
  describeCosmosFailure,
} from '@/sources/cosmos/read-only-client';

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

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ gcid: string }>;
  searchParams: Promise<{ via?: string; from?: string; tab?: string; product?: string }>;
}) {
  const [{ gcid: rawGcid }, query] = await Promise.all([params, searchParams]);
  const gcid = Number(rawGcid);
  if (!Number.isInteger(gcid) || gcid <= 0) notFound();

  const from = Number(query.from);
  const lookedUpAs = { via: query.via, from: Number.isInteger(from) && from > 0 ? from : undefined };
  const tab = parseProfileTab(query.tab);
  const tabQuery = { via: lookedUpAs.via, from: lookedUpAs.from, product: query.product };

  const source = sourceFor(gcid);

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

  const { config, exact } = await loadConfigFor(
    typeof profile?.regulation === 'string' ? profile.regulation : null,
    profile?.configurationVersion ?? null,
  );

  const answers = profile?.questionsAnswers ?? [];
  const formula = config ? deriveFormula(config) : null;
  const outcome = deriveOutcome(profile, config?.scoreMappings ?? null);
  const nmOutcome = deriveNmOutcome(profile, config);
  const monitoring = profile ? explainMonitoring(profile, deriveMonitoring(profile)) : null;
  const tree = normaliseTree(profile?.suitability?.suitabilityCalculationDetails);
  const explanation = explainTree(
    tree.nodes,
    riskLevelName(profile?.suitability?.clientRiskLevel),
    config,
    answers,
  );

  const suitabilityWarnings = [...tree.warnings, ...explanation.warnings];
  const nmWarnings: string[] = [];

  if (!source.capabilities.tree) {
    suitabilityWarnings.push(
      `The active source (${source.label}) cannot return the calculation tree — it is not part of ` +
        'that contract. An empty tree below says nothing about this user.',
    );
  } else if (outcome.kind === 'assessed' && tree.nodes.length === 0) {
    suitabilityWarnings.push(
      'This user has a risk level but no stored calculation nodes, so there is no way to show how ' +
        'it was reached. Either the tree was never persisted or it was lost on the way here.',
    );
  }
  if (!source.capabilities.answers) {
    suitabilityWarnings.push(
      `The active source cannot return the user's answers either, so the answers table is empty ` +
        'regardless of what they answered.',
    );
  }

  if (profile && config && !exact) {
    const msg =
      `This result was produced by ${profile.regulation} v${profile.configurationVersion}, which is not ` +
      `in config-prod/. Showing ${config.id} instead, so answer-scoring details may differ from what actually ran.`;
    suitabilityWarnings.push(msg);
    nmWarnings.push(msg);
  }

  if (answers.some((entry) => assumesCurrency(entry.questionId))) {
    const msg =
      `Amounts are shown in ${CopySnapshot.assumedCurrency}. The profile does not record the ` +
      'account currency, so that is this view\u2019s assumption and not necessarily what the user saw.';
    suitabilityWarnings.push(msg);
    nmWarnings.push(msg);
  }

  if (
    profile?.lastAnswerOccurredAt &&
    profile.updatedOn &&
    profile.lastAnswerOccurredAt > profile.updatedOn
  ) {
    const msg =
      'The user answered something after this result was calculated, so the stored tree reflects an ' +
      'older set of answers. Any comparison against a recomputation would be meaningless until it reruns.';
    suitabilityWarnings.push(msg);
    nmWarnings.push(msg);
  }

  if (
    outcome.kind === 'assessed' &&
    outcome.hardBlocked !== true &&
    nmOutcome.kind === 'assessed' &&
    nmOutcome.products.some((p) => p.result === 'Blocked')
  ) {
    nmWarnings.push(
      'Copy suitability is not hard-blocked, but at least one Negative Market product is Blocked. ' +
        'These are separate tests — passing one does not pass the other.',
    );
  }

  if (nmOutcome.kind === 'assessed' && !profile?.productNegativeMarkets) {
    nmWarnings.push(
      'The configuration defines Negative Market products, but this profile carries no stored ' +
        'productNegativeMarkets section.',
    );
  }

  const provenance =
    outcome.kind === 'never-calculated' ? nmOutcome.provenance : outcome.provenance;

  const selectedProduct =
    nmOutcome.kind === 'assessed'
      ? (nmOutcome.products.find((p) => p.storedKey === query.product)?.storedKey ??
        nmOutcome.products.find((p) => p.result === 'Blocked')?.storedKey ??
        nmOutcome.products[0]?.storedKey)
      : undefined;

  return (
    <div>
      <LookupRow gcid={gcid} via={lookedUpAs.via} from={lookedUpAs.from} />

      <div className="space-y-6">
        {source.id !== activeSource().id && (
          <p className="rounded-xl border border-[rgba(237,197,0,0.24)] bg-[rgba(237,197,0,0.08)] px-4 py-3 text-[13px]">
            This is a worked example, not a customer. {gcid} falls in the reserved example range, so
            it is served from {source.label} regardless of what the header says.
          </p>
        )}

        <ProfileTestTabs gcid={gcid} active={tab} query={tabQuery} />

        {tab === 'suitability' && (
          <SuitabilityPanel
            outcome={outcome}
            warnings={suitabilityWarnings}
            tree={tree}
            explanation={explanation}
            formula={formula}
            exact={exact}
            config={config}
            monitoring={monitoring}
            answers={answers}
            provenance={provenance}
          />
        )}

        {tab === 'negative-market' && (
          <NegativeMarketPanel
            nmOutcome={nmOutcome}
            warnings={nmWarnings}
            gcid={gcid}
            selectedProduct={selectedProduct}
            tabQuery={tabQuery}
            config={config}
            exact={exact}
            answers={answers}
            provenance={nmOutcome.provenance}
          />
        )}

        {tab === 'appropriateness' && <AppropriatenessTab provenance={provenance} />}
      </div>
    </div>
  );
}

function SuitabilityPanel({
  outcome,
  warnings,
  tree,
  explanation,
  formula,
  exact,
  config,
  monitoring,
  answers,
  provenance,
}: {
  outcome: ReturnType<typeof deriveOutcome>;
  warnings: string[];
  tree: ReturnType<typeof normaliseTree>;
  explanation: ReturnType<typeof explainTree>;
  formula: ReturnType<typeof deriveFormula>;
  exact: boolean;
  config: Awaited<ReturnType<typeof loadConfigFor>>['config'];
  monitoring: ReturnType<typeof explainMonitoring> | null;
  answers: RawQuestionAnswers[];
  provenance: Provenance;
}) {
  const hardBlockChecks = explainHardBlock(config, answers);
  const storedBlocked = outcome.kind === 'assessed' ? outcome.hardBlocked : null;

  return (
    <div className="space-y-6">
      <OutcomeCard outcome={outcome} />
      <Warnings items={warnings} />

      {hardBlockChecks.length > 0 && (
        <HardBlockView checks={hardBlockChecks} storedBlocked={storedBlocked} />
      )}

      {tree.nodes.length > 0 && (
        <section>
          <ProfileSectionHead title="How it was calculated">
            <TreeControls />
          </ProfileSectionHead>
          <TreeView tree={tree} explanation={explanation} />
        </section>
      )}

      {formula && (
        <ProfileCollapsible
          title={`Formula — ${formula.regulation} v${formula.version}`}
          subtitle={
            exact
              ? 'The rules behind the result above, read from the configuration document that produced it.'
              : `The rules behind the result above, read from ${formula.id} — not the version that produced it.`
          }
        >
          <FormulaView formula={formula} />
        </ProfileCollapsible>
      )}

      {monitoring && (
        <ProfileCollapsible
          title="Ongoing monitoring"
          subtitle="A daily check that the money in copies has not outgrown what this user can sustain. Separate from the score above, and the only other thing that can stop a copy."
        >
          <MonitoringView explanation={monitoring} />
        </ProfileCollapsible>
      )}

      {answers.length > 0 && (
        <ProfileCollapsible
          title="Questions and answers by id"
          subtitle={
            config
              ? `Every answer on record with its question and answer ids, checked against ${config.id}.`
              : 'Every answer on record with its question and answer ids. No configuration loaded, so scoring coverage cannot be checked.'
          }
        >
          <AnswersTable answers={answers} coverage={buildCoverageIndex(config)} />
        </ProfileCollapsible>
      )}

      <ProvenanceSection provenance={provenance} />
    </div>
  );
}

function NegativeMarketPanel({
  nmOutcome,
  warnings,
  gcid,
  selectedProduct,
  tabQuery,
  config,
  exact,
  answers,
  provenance,
}: {
  nmOutcome: ReturnType<typeof deriveNmOutcome>;
  warnings: string[];
  gcid: number;
  selectedProduct: string | undefined;
  tabQuery: { via?: string; from?: number; product?: string };
  config: Awaited<ReturnType<typeof loadConfigFor>>['config'];
  exact: boolean;
  answers: RawQuestionAnswers[];
  provenance: Provenance;
}) {
  const nmCoverage = buildNmCoverageIndex(config);

  return (
    <div className="space-y-6">
      <NmOutcomeCard outcome={nmOutcome} />
      <Warnings items={warnings} />

      {nmOutcome.kind === 'assessed' && nmOutcome.products.length > 0 && selectedProduct && (
        <section>
          <ProfileSectionHead
            title="How it was calculated"
            subtitle="Stored rule results per product. Predicates come from the configuration — not recomputed here."
          />
          <NmRulesView
            gcid={gcid}
            products={nmOutcome.products}
            selectedKey={selectedProduct}
            query={tabQuery}
          />
        </section>
      )}

      {config && config.negativeMarketProducts.length > 0 && (
        <ProfileCollapsible
          title={`Formula — ${config.regulation} v${config.version}`}
          subtitle={
            exact
              ? 'Negative Market rules from the configuration document that produced these results.'
              : `Negative Market rules from ${config.id} — not necessarily the version that produced these results.`
          }
        >
          <NmFormulaView config={config} selectedKey={selectedProduct} />
        </ProfileCollapsible>
      )}

      {answers.length > 0 && (
        <ProfileCollapsible
          title="Questions and answers by id"
          subtitle={
            config
              ? `Answers on record, filtered to those referenced by Negative Market in ${config.id}.`
              : 'Answers on record. No configuration loaded, so NM coverage cannot be checked.'
          }
        >
          <AnswersTable
            answers={answers}
            coverage={nmCoverage}
            describeCoverage={nmCoverageLabel}
          />
        </ProfileCollapsible>
      )}

      <ProvenanceSection provenance={provenance} />
    </div>
  );
}
