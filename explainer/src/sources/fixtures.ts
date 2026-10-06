/**
 * Synthetic profiles. No PII, no credentials, no network.
 *
 * These exist so the renderer can be built and reviewed before any access question is
 * settled, and so the awkward states have something to render. Every state below is one the
 * app will meet in production and get wrong if it was never designed for:
 *
 *   - a normal scored user, whose numbers are taken from the worked example in tech.md §4.6
 *     rather than invented, so the tree is arithmetically consistent
 *   - hard blocked, and blocked by ongoing monitoring, which are different gates
 *   - below verification level 2, which is *absent*, not Minimal
 *   - an internal eToro account, whose stored result is a hardcoded placeholder
 *   - a regulation that no longer scores (MAS from v3)
 *   - an older configuration version whose leaves carry no `Question` field
 *   - a live CySEC v23 tree, shape-for-shape, with every identifier stripped
 *   - questions left unanswered, which fall back to the configured default
 *
 * ## Regulation coverage
 *
 * Five regulations still score: CySEC, FCA, ASIC, ASICGAML and FSRA. All five share one
 * scoring skeleton — root `Min(A, B)`, `A = Min(C5, C6)`, `B = Avg` of its components rounded
 * down — and CySEC alone adds component 9, the MiCA crypto assessment. So there is at least
 * one example per regulation, each carrying whatever is genuinely specific to it:
 *
 *   - CySEC has component 9; the others average six components, not seven
 *   - ASICGAML's hard block has a fifth condition and a wider risk-appetite band, so it blocks
 *     users the other four leave alone
 *   - FCA declares a `Blocked` fallback on its check that the engine never reads
 *
 * MAS appears once, as the regulation that stopped scoring — its current configuration has no
 * factors, so there is nothing to score and no second MAS example worth having.
 *
 * Every level below was derived from the regulation's own configuration document rather than
 * chosen by hand, so each tree is arithmetically consistent with the config that names it.
 *
 * The node shape here mirrors what Cosmos actually stores, verified against 578 production
 * trees: no level discriminator on any node, and question identity carried as the
 * `KycQuestion` enum *name* in both `Name` and `Question`. Earlier revisions of this file
 * invented a `suitabilityCalculationDetailLevelId` and numeric question ids on tree nodes;
 * no production document has either, so the fixtures were testing a shape that never arrives.
 *
 * The GCIDs are small and obviously fake.
 */

import { KycAnswerIds, KycQuestionIds } from '@/domain/generated/kyc-enums';
import type { RawNode } from '@/domain/tree';
import type {
  IdKind,
  OtherSpace,
  ProfileSource,
  RawProfile,
  Resolution,
  SourceCapabilities,
} from './types';

const LEVEL = { Minimal: 100, Low: 200, Medium: 300, MediumHigh: 400, High: 500 } as const;
const BLOCK = { Blocked: 1, NotBlocked: 2 } as const;

function nmRule(name: string, result: 'Blocked' | 'NotBlocked') {
  return { rule: name, result, checkResult: result, attempts: [] };
}

function nmProduct(
  result: 'Blocked' | 'NotBlocked',
  rules: ReturnType<typeof nmRule>[],
  version = 24,
) {
  return {
    result,
    assessmentExpired: false,
    configurationVersion: version,
    ruleResults: rules,
    isAllQuestionsAnswered: true,
  };
}

/** CySEC v24 — four NM products with KnockOut + TradingExperience on the first three. */
function cysecNmProducts(cfdResult: 'Blocked' | 'NotBlocked') {
  const experience = [nmRule('KnockOut', 'NotBlocked'), nmRule('TradingExperience', 'NotBlocked')];
  const knockoutBlocked = [nmRule('KnockOut', 'Blocked'), nmRule('TradingExperience', 'NotBlocked')];
  return {
    Cfd: nmProduct(cfdResult, cfdResult === 'Blocked' ? knockoutBlocked : experience),
    Futures: nmProduct('NotBlocked', experience),
    Margin: nmProduct('NotBlocked', experience),
    ExperimentalCrypto: nmProduct('NotBlocked', [nmRule('KnockOut', 'NotBlocked')]),
  };
}

/**
 * Questions and answers are referenced by enum *name*, resolved to ids at module load.
 *
 * Hardcoding the numbers here was the first attempt and it produced fixtures that rendered
 * confidently wrong labels — an invented answer id resolves to some unrelated real answer, and
 * nothing complains. Resolving by name means a typo throws on startup instead.
 */
type QuestionName = keyof typeof KycQuestionIds;

function q(name: QuestionName): number {
  const id = KycQuestionIds[name];
  if (id === undefined) throw new Error(`Fixture references unknown question "${name}"`);
  return id;
}

function a(name: keyof typeof KycAnswerIds): number {
  const id = KycAnswerIds[name];
  if (id === undefined) throw new Error(`Fixture references unknown answer "${name}"`);
  return id;
}

const Q = {
  TradingKnowledge: q('TradingKnowledge'),
  TradingStrategy: q('TradingStrategy'),
  TradingPurpose: q('TradingPurpose'),
  RiskAppetite: q('RiskAppetite'),
  AnnualIncome: q('AnnualIncome'),
  LiquidAssets: q('LiquidAssets'),
  InvestmentPlan: q('InvestmentPlan'),
  IncomeSource: q('IncomeSource'),
  TradingKnowledgeAssessment: q('TradingKnowledgeAssessment'),
  Equities: q('Equities'),
  EquitiesInvestedAmount: q('EquitiesInvestedAmount'),
  Crypto: q('Crypto'),
  CryptoInvestedAmount: q('CryptoInvestedAmount'),
  LeveragedCfd: q('LeveragedCfd'),
  LeveragedCfdInvestedAmount: q('LeveragedCfdInvestedAmount'),
  MiCACryptoAssessmentHighVolatility: q('MiCACryptoAssessmentHighVolatility'),
  MiCACryptoAssessmentCyberRisks: q('MiCACryptoAssessmentCyberRisks'),
  MiCACryptoAssessmentRecoverLoss: q('MiCACryptoAssessmentRecoverLoss'),
  MiCACryptoAssessmentInvestingRisks: q('MiCACryptoAssessmentInvestingRisks'),
  MiCACryptoAssessmentPrivateKey: q('MiCACryptoAssessmentPrivateKey'),
} as const;

/**
 * A question node as stored: identity in `Name`, repeated in `Question`. Passing the name
 * through `q()` first is what makes a typo fail loudly instead of rendering "Question".
 */
function question(name: QuestionName, level: number, options?: { omitQuestionField?: boolean }): RawNode {
  q(name);
  return {
    name,
    ...(options?.omitQuestionField ? {} : { question: name }),
    clientRiskLevel: level,
    childs: [],
  };
}

function component(name: string, level: number, questions: RawNode[]): RawNode {
  return { name, clientRiskLevel: level, childs: questions };
}

function factor(name: string, level: number, revolvingDoorOrder: number, components: RawNode[]): RawNode {
  return { name, clientRiskLevel: level, revolvingDoorOrder, childs: components };
}

/**
 * Components 1, 2, 3, 4 and 7 for the §4.6 worked example. Every regulation has these, and the
 * answer set produces the same levels under each, so they are shared.
 *
 * Nothing above component level is shared, deliberately. An earlier revision had one tree that
 * five fixtures reused, with the FCA one reaching in to delete component 9 — and because Factor
 * B's average changes when you remove a component, that fixture stored a level its own tree
 * could not produce. The app duly reported the disagreement, which read as an engine bug.
 */
function sharedComponents(options?: { omitQuestionField?: boolean }): RawNode[] {
  const leaf = (name: QuestionName, level: number) => question(name, level, options);
  return [
    component('1', LEVEL.Medium, [
      leaf('Equities', LEVEL.Medium),
      leaf('Crypto', LEVEL.Medium),
      leaf('LeveragedCfd', LEVEL.Medium),
    ]),
    component('2', LEVEL.Medium, [
      leaf('EquitiesInvestedAmount', LEVEL.Medium),
      leaf('CryptoInvestedAmount', LEVEL.Medium),
      leaf('LeveragedCfdInvestedAmount', LEVEL.Medium),
    ]),
    component('3', LEVEL.MediumHigh, [leaf('TradingKnowledge', LEVEL.MediumHigh)]),
    component('4', LEVEL.MediumHigh, [leaf('TradingStrategy', LEVEL.MediumHigh)]),
  ];
}

/** Factor A for the §4.6 worked example: purpose and risk appetite both MediumHigh. */
function workedExampleFactorA(options?: { omitQuestionField?: boolean }): RawNode {
  const leaf = (name: QuestionName, level: number) => question(name, level, options);
  return factor('A', LEVEL.MediumHigh, 2, [
    component('5', LEVEL.MediumHigh, [leaf('TradingPurpose', LEVEL.MediumHigh)]),
    component('6', LEVEL.MediumHigh, [leaf('RiskAppetite', LEVEL.MediumHigh)]),
  ]);
}

/**
 * Component 9, the MiCA crypto assessment, unanswered.
 *
 * CySEC is the only regulation that has it. The component declares its own default of Low, which
 * is why five unanswered questions land on Low rather than the document-wide Medium.
 */
function micaComponentUnanswered(options?: { omitQuestionField?: boolean }): RawNode {
  const leaf = (name: QuestionName, level: number) => question(name, level, options);
  return component('9', LEVEL.Low, [
    leaf('MiCACryptoAssessmentHighVolatility', LEVEL.Low),
    leaf('MiCACryptoAssessmentCyberRisks', LEVEL.Low),
    leaf('MiCACryptoAssessmentRecoverLoss', LEVEL.Low),
    leaf('MiCACryptoAssessmentInvestingRisks', LEVEL.Low),
    leaf('MiCACryptoAssessmentPrivateKey', LEVEL.Low),
  ]);
}

/**
 * The tech.md §4.6 worked example under CySEC-24. Factor B averages 19/7 = 2.71 and rounds down
 * to Medium, which the root `Min` keeps despite Factor A being a level higher.
 */
function workedExampleTree(): RawNode[] {
  return [
    workedExampleFactorA(),
    factor('B', LEVEL.Medium, 1, [
      ...sharedComponents(),
      component('7', LEVEL.High, [question('IncomeSource', LEVEL.High)]),
      component('8', LEVEL.High, [question('TradingKnowledgeAssessment', LEVEL.High)]),
      micaComponentUnanswered(),
    ]),
  ];
}

/**
 * The same answers under FCA-15, which has no component 9.
 *
 * Removing the lowest component raises Factor B: the remaining six average to exactly 3, so this
 * user comes out a level higher under FCA than under CySEC on identical answers. That is the
 * clearest illustration of why the MiCA component is not a cosmetic difference.
 */
function fcaWorkedExampleTree(options?: { omitQuestionField?: boolean }): RawNode[] {
  const leaf = (name: QuestionName, level: number) => question(name, level, options);
  return [
    workedExampleFactorA(options),
    factor('B', LEVEL.MediumHigh, 1, [
      ...sharedComponents(options),
      component('7', LEVEL.High, [leaf('IncomeSource', LEVEL.High)]),
      component('8', LEVEL.High, [leaf('TradingKnowledgeAssessment', LEVEL.High)]),
    ]),
  ];
}

/**
 * The worked example with an income source no configuration scores, so component 7 falls to the
 * default of Medium instead of High. Factor B drops to 17/7 = 2.43, still Medium.
 */
function unscoredIncomeTree(): RawNode[] {
  return [
    workedExampleFactorA(),
    factor('B', LEVEL.Medium, 1, [
      ...sharedComponents(),
      component('7', LEVEL.Medium, [question('IncomeSource', LEVEL.Medium)]),
      component('8', LEVEL.High, [question('TradingKnowledgeAssessment', LEVEL.High)]),
      micaComponentUnanswered(),
    ]),
  ];
}

/**
 * The hard-blocked user's tree. Only the four block questions are answered, so everything else
 * takes a default: Factor B averages 13/7 = 1.86 to Low, and Factor A is Low on risk appetite
 * alone. The score is irrelevant to this user — the block overrides it — but the engine still
 * computes and stores one, and the app has to render both.
 */
function hardBlockedTree(): RawNode[] {
  return [
    factor('A', LEVEL.Low, 2, [
      component('5', LEVEL.Medium, [question('TradingPurpose', LEVEL.Medium)]),
      component('6', LEVEL.Low, [question('RiskAppetite', LEVEL.Low)]),
    ]),
    factor('B', LEVEL.Low, 1, [
      component('1', LEVEL.Medium, [
        question('Equities', LEVEL.Medium),
        question('Crypto', LEVEL.Medium),
        question('LeveragedCfd', LEVEL.Medium),
      ]),
      component('2', LEVEL.Medium, [
        question('EquitiesInvestedAmount', LEVEL.Medium),
        question('CryptoInvestedAmount', LEVEL.Medium),
        question('LeveragedCfdInvestedAmount', LEVEL.Medium),
      ]),
      component('3', LEVEL.Medium, [question('TradingKnowledge', LEVEL.Medium)]),
      component('4', LEVEL.Medium, [question('TradingStrategy', LEVEL.Medium)]),
      component('7', LEVEL.Medium, [question('IncomeSource', LEVEL.Medium)]),
      component('8', LEVEL.Medium, [question('TradingKnowledgeAssessment', LEVEL.Medium)]),
      micaComponentUnanswered(),
    ]),
  ];
}

/**
 * A live CySEC v23 tree, copied node-for-node from a production profile with the GCID, CID
 * and every answer removed.
 *
 * Worth keeping as a fixture because it is the case the arithmetic is easiest to get wrong:
 * the user is experienced — components 1, 2, 7 and 9 all `High` — so Factor B averages to
 * `MediumHigh`. But their trading purpose scored `Low`, Factor A is a `Min`, and the root is
 * a `Min`, so the whole profile lands on `Low` and an authorised risk score of 3. Strength in
 * one half never compensates for weakness in the other, and this is what that looks like.
 */
function liveCysec23Tree(): RawNode[] {
  return [
    factor('A', LEVEL.Low, 2, [
      component('5', LEVEL.Low, [question('TradingPurpose', LEVEL.Low)]),
      component('6', LEVEL.MediumHigh, [question('RiskAppetite', LEVEL.MediumHigh)]),
    ]),
    factor('B', LEVEL.MediumHigh, 1, [
      component('1', LEVEL.High, [
        question('Equities', LEVEL.High),
        question('Crypto', LEVEL.MediumHigh),
        question('LeveragedCfd', LEVEL.High),
      ]),
      component('2', LEVEL.High, [
        question('EquitiesInvestedAmount', LEVEL.Medium),
        question('CryptoInvestedAmount', LEVEL.High),
        question('LeveragedCfdInvestedAmount', LEVEL.High),
      ]),
      component('3', LEVEL.Medium, [question('TradingKnowledge', LEVEL.Medium)]),
      component('4', LEVEL.Medium, [question('TradingStrategy', LEVEL.Medium)]),
      component('7', LEVEL.High, [question('IncomeSource', LEVEL.High)]),
      component('8', LEVEL.Medium, [question('TradingKnowledgeAssessment', LEVEL.Medium)]),
      component('9', LEVEL.High, [
        question('MiCACryptoAssessmentHighVolatility', LEVEL.High),
        question('MiCACryptoAssessmentCyberRisks', LEVEL.High),
        question('MiCACryptoAssessmentRecoverLoss', LEVEL.High),
        question('MiCACryptoAssessmentInvestingRisks', LEVEL.High),
        question('MiCACryptoAssessmentPrivateKey', LEVEL.High),
      ]),
    ]),
  ];
}

/**
 * ASIC. The six-component Factor B that every regulation except CySEC uses.
 *
 * Worth having because the CySEC trees are the ones everyone looks at first, and they carry a
 * seventh component that does not exist anywhere else. Factor B averages to 19/6 = 3.17 and
 * rounds down to MediumHigh, so the fractional part is visibly discarded.
 */
function asicTree(): RawNode[] {
  return [
    factor('A', LEVEL.MediumHigh, 2, [
      component('5', LEVEL.MediumHigh, [question('TradingPurpose', LEVEL.MediumHigh)]),
      component('6', LEVEL.MediumHigh, [question('RiskAppetite', LEVEL.MediumHigh)]),
    ]),
    factor('B', LEVEL.MediumHigh, 1, [
      component('1', LEVEL.MediumHigh, [
        question('Equities', LEVEL.MediumHigh),
        question('Crypto', LEVEL.MediumHigh),
        question('LeveragedCfd', LEVEL.Medium),
      ]),
      component('2', LEVEL.Medium, [
        question('EquitiesInvestedAmount', LEVEL.Medium),
        question('CryptoInvestedAmount', LEVEL.Medium),
        question('LeveragedCfdInvestedAmount', LEVEL.Medium),
      ]),
      component('3', LEVEL.MediumHigh, [question('TradingKnowledge', LEVEL.MediumHigh)]),
      component('4', LEVEL.MediumHigh, [question('TradingStrategy', LEVEL.MediumHigh)]),
      component('7', LEVEL.High, [question('IncomeSource', LEVEL.High)]),
      component('8', LEVEL.High, [question('TradingKnowledgeAssessment', LEVEL.High)]),
    ]),
  ];
}

/**
 * ASICGAML. A cautious, inexperienced user who ends up hard blocked.
 *
 * The scoring is beside the point here — Factor B averages 11/6 = 1.83 and rounds down to Low,
 * which the root `Min` keeps. The block is the point: see `ANSWERS_GAML_BLOCKED`.
 */
function gamlTree(): RawNode[] {
  return [
    factor('A', LEVEL.Medium, 2, [
      component('5', LEVEL.Medium, [question('TradingPurpose', LEVEL.Medium)]),
      component('6', LEVEL.Medium, [question('RiskAppetite', LEVEL.Medium)]),
    ]),
    factor('B', LEVEL.Low, 1, [
      component('1', LEVEL.Medium, [
        question('Equities', LEVEL.Medium),
        question('Crypto', LEVEL.Medium),
        question('LeveragedCfd', LEVEL.Medium),
      ]),
      component('2', LEVEL.Medium, [
        question('EquitiesInvestedAmount', LEVEL.Medium),
        question('CryptoInvestedAmount', LEVEL.Medium),
        question('LeveragedCfdInvestedAmount', LEVEL.Medium),
      ]),
      component('3', LEVEL.Medium, [question('TradingKnowledge', LEVEL.Medium)]),
      component('4', LEVEL.Medium, [question('TradingStrategy', LEVEL.Medium)]),
      component('7', LEVEL.Low, [question('IncomeSource', LEVEL.Low)]),
      component('8', LEVEL.Medium, [question('TradingKnowledgeAssessment', LEVEL.Medium)]),
    ]),
  ];
}

/**
 * FSRA. An experienced trader who never finished the questionnaire.
 *
 * Trading knowledge, strategy and the knowledge assessment are all unanswered, so components
 * 3, 4 and 8 sit on the configured default of Medium. Those three defaults are what pull
 * Factor B from High to MediumHigh: the six components average to exactly 3 instead of 3.5,
 * and the answered ones are all High. A user is charged a full level for the questions they
 * skipped, and this is what that looks like on screen.
 */
function fsraTree(): RawNode[] {
  return [
    factor('A', LEVEL.High, 2, [
      component('5', LEVEL.High, [question('TradingPurpose', LEVEL.High)]),
      component('6', LEVEL.High, [question('RiskAppetite', LEVEL.High)]),
    ]),
    factor('B', LEVEL.MediumHigh, 1, [
      component('1', LEVEL.High, [
        question('Equities', LEVEL.High),
        question('Crypto', LEVEL.High),
        question('LeveragedCfd', LEVEL.MediumHigh),
      ]),
      component('2', LEVEL.High, [
        question('EquitiesInvestedAmount', LEVEL.Medium),
        question('CryptoInvestedAmount', LEVEL.High),
        question('LeveragedCfdInvestedAmount', LEVEL.MediumHigh),
      ]),
      component('3', LEVEL.Medium, [question('TradingKnowledge', LEVEL.Medium)]),
      component('4', LEVEL.Medium, [question('TradingStrategy', LEVEL.Medium)]),
      component('7', LEVEL.High, [question('IncomeSource', LEVEL.High)]),
      component('8', LEVEL.Medium, [question('TradingKnowledgeAssessment', LEVEL.Medium)]),
    ]),
  ];
}

/** The §4.6 answer set. Every value here is scored by CySEC-24 except where noted. */
const ANSWERS_WORKED_EXAMPLE = [
  { questionId: Q.TradingPurpose, answerIds: [a('AdditionalRevenues')] },
  { questionId: Q.RiskAppetite, answerIds: [a('Plus20ToMinus12Percent')] },
  { questionId: Q.Equities, answerIds: [a('NeverTraded')] },
  { questionId: Q.EquitiesInvestedAmount, answerIds: [a('NeverVolume')] },
  { questionId: Q.TradingKnowledge, answerIds: [a('TradingCourses')] },
  { questionId: Q.TradingStrategy, answerIds: [a('FewWeeksUpToSeveralMonth')] },
  { questionId: Q.IncomeSource, answerIds: [a('Salary')] },
  // Multi-select: component 8 is a weighted quiz, so several ids on one question is normal.
  { questionId: Q.TradingKnowledgeAssessment, answerIds: [a('Leverage'), a('MarginCall'), a('Cfd')] },
];

/**
 * The same set, but with income source set to `InvestmentsDeposits`.
 *
 * That answer is the known funnel-versus-config gap: the funnel offers it, no regulation's
 * configuration scores it, and it silently falls back to the config default. 28,850 users have
 * picked it (verification.md C-48). A fixture that exercises it is how the app's "not scored by
 * this config" flag stays honest.
 */
const ANSWERS_WITH_UNSCORED = ANSWERS_WORKED_EXAMPLE.map((entry) =>
  entry.questionId === Q.IncomeSource
    ? { questionId: Q.IncomeSource, answerIds: [a('InvestmentsDeposits')] }
    : entry,
);

/**
 * Answers chosen to reproduce every level in `liveCysec23Tree`, derived from CySEC-24 itself.
 *
 * The tree is real but its answers were stripped, and pairing a real tree with an unrelated answer
 * set makes the app report that a dozen questions "do not reproduce" — which is true of the fixture
 * and says nothing about the engine. A fixture that cries wolf is worse than no fixture, so these
 * are the answers that actually produce those levels.
 */
const ANSWERS_LIVE_SHAPE = [
  { questionId: Q.TradingPurpose, answerIds: [a('PurposeInvestments')] },
  { questionId: Q.RiskAppetite, answerIds: [a('Plus20ToMinus12Percent')] },
  { questionId: Q.Equities, answerIds: [a('Above20')] },
  { questionId: Q.Crypto, answerIds: [a('ZeroTo10')] },
  { questionId: Q.LeveragedCfd, answerIds: [a('TenTo20')] },
  { questionId: Q.EquitiesInvestedAmount, answerIds: [a('OneTo500')] },
  { questionId: Q.CryptoInvestedAmount, answerIds: [a('From500To2000')] },
  { questionId: Q.LeveragedCfdInvestedAmount, answerIds: [a('From500To2000')] },
  { questionId: Q.TradingKnowledge, answerIds: [a('NoFinancialKnowledge')] },
  { questionId: Q.TradingStrategy, answerIds: [a('MoreThenSeveralMonths')] },
  { questionId: Q.IncomeSource, answerIds: [a('Salary')] },
  // Two of the five live statements judged correctly, which totals -4 and bands as Medium. The
  // sixth statement is retired from the funnel and contributes +2 regardless.
  { questionId: Q.TradingKnowledgeAssessment, answerIds: [a('NewerCfd'), a('NewerStopLossTrigger')] },
  { questionId: Q.MiCACryptoAssessmentHighVolatility, answerIds: [a('MiCACanLeadToSignificantGainLoss')] },
  { questionId: Q.MiCACryptoAssessmentCyberRisks, answerIds: [a('MiCAEnableTwoFactorAuth')] },
  { questionId: Q.MiCACryptoAssessmentRecoverLoss, answerIds: [a('MiCADoesNotCover')] },
  { questionId: Q.MiCACryptoAssessmentInvestingRisks, answerIds: [a('MiCARiskLosingInvestments')] },
  { questionId: Q.MiCACryptoAssessmentPrivateKey, answerIds: [a('MiCASecretCode')] },
];

/** Every leg of the CySEC / FCA hard block, taken from the config's own QuestionAnswerChecks. */
const ANSWERS_HARD_BLOCKED = [
  { questionId: Q.RiskAppetite, answerIds: [a('Plus5ToMinus3Percent')] },
  { questionId: Q.TradingPurpose, answerIds: [a('FuturePlanning')] },
  { questionId: Q.AnnualIncome, answerIds: [a('UpTo10K')] },
  { questionId: Q.LiquidAssets, answerIds: [a('UpTo10K')] },
];

/** Reproduces `asicTree`. Component 8 here uses the older statement set, scored per answer. */
const ANSWERS_ASIC = [
  { questionId: Q.TradingPurpose, answerIds: [a('AdditionalRevenues')] },
  { questionId: Q.RiskAppetite, answerIds: [a('Plus20ToMinus12Percent')] },
  { questionId: Q.Equities, answerIds: [a('TenTo20')] },
  { questionId: Q.Crypto, answerIds: [a('ZeroTo10')] },
  { questionId: Q.LeveragedCfd, answerIds: [a('NeverTraded')] },
  { questionId: Q.EquitiesInvestedAmount, answerIds: [a('From500To2000')] },
  { questionId: Q.CryptoInvestedAmount, answerIds: [a('OneTo500')] },
  { questionId: Q.LeveragedCfdInvestedAmount, answerIds: [a('NeverVolume')] },
  { questionId: Q.TradingKnowledge, answerIds: [a('TradingCourses')] },
  { questionId: Q.TradingStrategy, answerIds: [a('FewWeeksUpToSeveralMonth')] },
  { questionId: Q.IncomeSource, answerIds: [a('Salary')] },
  { questionId: Q.TradingKnowledgeAssessment, answerIds: [a('Leverage'), a('MarginCall'), a('Cfd')] },
  { questionId: Q.AnnualIncome, answerIds: [a('Between50KAnd200K')] },
  { questionId: Q.LiquidAssets, answerIds: [a('Between200KAnd500K')] },
];

/**
 * Chosen so ASICGAML blocks and nothing else does.
 *
 * GAML's check has five legs where the other four regulations have four, and two of them are
 * wider: its risk-appetite list includes `Plus10ToMinus6Percent`, and it adds `IncomeSource =
 * Pension`. Run these same answers through CySEC, FCA, ASIC or FSRA and the risk-appetite leg
 * is the only one that fails — which is enough, because the check requires all of them. So this
 * user is blocked in one Australian regime and unblocked in every other jurisdiction.
 */
const ANSWERS_GAML_BLOCKED = [
  { questionId: Q.RiskAppetite, answerIds: [a('Plus10ToMinus6Percent')] },
  { questionId: Q.TradingPurpose, answerIds: [a('FuturePlanning')] },
  { questionId: Q.AnnualIncome, answerIds: [a('Between10KAnd50K')] },
  { questionId: Q.LiquidAssets, answerIds: [a('UpTo10K')] },
  { questionId: Q.IncomeSource, answerIds: [a('Pension')] },
  { questionId: Q.Equities, answerIds: [a('ZeroTo10')] },
  { questionId: Q.Crypto, answerIds: [a('NeverTraded')] },
  { questionId: Q.LeveragedCfd, answerIds: [a('NeverTraded')] },
  { questionId: Q.EquitiesInvestedAmount, answerIds: [a('OneTo500')] },
  { questionId: Q.CryptoInvestedAmount, answerIds: [a('NeverVolume')] },
  { questionId: Q.LeveragedCfdInvestedAmount, answerIds: [a('NeverVolume')] },
  { questionId: Q.TradingKnowledge, answerIds: [a('NoFinancialKnowledge')] },
  { questionId: Q.TradingStrategy, answerIds: [a('MoreThenSeveralMonths')] },
  { questionId: Q.TradingKnowledgeAssessment, answerIds: [a('Leverage')] },
];

/**
 * Reproduces `fsraTree`. Trading knowledge, strategy and the knowledge assessment are absent
 * on purpose — that omission is the whole point of the example, so do not "complete" it.
 */
const ANSWERS_FSRA_INCOMPLETE = [
  { questionId: Q.TradingPurpose, answerIds: [a('ShortTermReturns')] },
  { questionId: Q.RiskAppetite, answerIds: [a('Plus40ToMinus24Percent')] },
  { questionId: Q.Equities, answerIds: [a('Above20')] },
  { questionId: Q.Crypto, answerIds: [a('TenTo20')] },
  { questionId: Q.LeveragedCfd, answerIds: [a('ZeroTo10')] },
  { questionId: Q.EquitiesInvestedAmount, answerIds: [a('Above2000')] },
  { questionId: Q.CryptoInvestedAmount, answerIds: [a('From500To2000')] },
  { questionId: Q.LeveragedCfdInvestedAmount, answerIds: [a('OneTo500')] },
  { questionId: Q.IncomeSource, answerIds: [a('Salary')] },
  { questionId: Q.AnnualIncome, answerIds: [a('Between200KAnd500K')] },
  { questionId: Q.LiquidAssets, answerIds: [a('Between500KAnd1M')] },
];

/**
 * The three answers behind the ongoing-monitoring limit, kept apart from the scored sets above.
 *
 * They are separate because they change nothing about the tree — no configuration scores income,
 * liquid assets or the yearly deposit — so a fixture can pick its own three without touching the
 * arithmetic it was built to demonstrate.
 *
 * Every stored `financialSustainability` below is the figure these answers actually produce, worked
 * out by hand against `ccm.ts`. Inventing round numbers instead was tempting and would have made
 * every example report that the app cannot reproduce its own limit, which is the same trap the
 * shared-tree revision fell into: a fixture that cries wolf trains people to ignore the warning
 * that matters. Where an example is *meant* to disagree, its description says so.
 */
function monitoringAnswers(
  income: keyof typeof KycAnswerIds,
  liquidAssets: keyof typeof KycAnswerIds,
  yearlyDeposit: keyof typeof KycAnswerIds,
) {
  return [
    { questionId: Q.AnnualIncome, answerIds: [a(income)] },
    { questionId: Q.LiquidAssets, answerIds: [a(liquidAssets)] },
    { questionId: Q.InvestmentPlan, answerIds: [a(yearlyDeposit)] },
  ];
}

/** Just the deposit question, for the sets that already carry income and liquid assets. */
function depositAnswer(yearlyDeposit: keyof typeof KycAnswerIds) {
  return [{ questionId: Q.InvestmentPlan, answerIds: [a(yearlyDeposit)] }];
}

interface Fixture {
  description: string;
  profile: RawProfile | null;
  cid?: number;
  username?: string;
}

const FIXTURES: Record<number, Fixture> = {
  1001: {
    description: 'CySEC — scored Medium, the worked example from tech.md §4.6',
    cid: 9001,
    username: 'fixture_medium',
    profile: {
      gcid: 1001,
      regulation: 'CySEC',
      countryId: 56,
      verificationLevel: 2,
      configurationVersion: 24,
      recalculationReason: 4,
      updatedOn: '2026-07-02T09:14:00Z',
      lastAnswerOccurredAt: '2026-07-02T09:12:00Z',
      questionsAnswers: [
        ...ANSWERS_WORKED_EXAMPLE,
        ...monitoringAnswers('Between10KAnd50K', 'Between50KAnd200K', 'AnswerBetween20KAnd50K'),
      ],
      suitability: {
        clientRiskLevel: LEVEL.Medium,
        suitabilityBlock: BLOCK.NotBlocked,
        isAllQuestionsAnswered: true,
        // Balance sheet 50% x 30,000 + 50% x 125,000 = 77,500. Intent 50% x 35,000 x 2 years
        // (first deposit 2025, result 2026) = 35,000, so the declared plan sets the limit.
        ongoingMonitoring: {
          ftdDate: '2025-02-14T00:00:00Z',
          financialSustainability: 35000,
          copyUtilization: 22000,
          manuallyUnblocked: false,
        },
        suitabilityCalculationDetails: workedExampleTree(),
      },
      productNegativeMarkets: cysecNmProducts('NotBlocked'),
    },
  },

  1002: {
    description: 'CySEC — hard blocked: lowest risk appetite plus capital preservation',
    cid: 9002,
    username: 'fixture_blocked',
    profile: {
      gcid: 1002,
      regulation: 'CySEC',
      countryId: 56,
      verificationLevel: 3,
      configurationVersion: 24,
      recalculationReason: 4,
      updatedOn: '2026-06-11T16:02:00Z',
      lastAnswerOccurredAt: '2026-06-11T16:00:00Z',
      questionsAnswers: [...ANSWERS_HARD_BLOCKED, ...depositAnswer('AnswerBetween20KAnd50K')],
      suitability: {
        clientRiskLevel: LEVEL.Low,
        suitabilityBlock: BLOCK.Blocked,
        isAllQuestionsAnswered: true,
        // The same two answers that trip the hard block also make this the rare user whose
        // balance sheet, not their stated plan, sets the monitoring limit: 50% x 5,000 twice is
        // 5,000, against an intent of 50% x 35,000 x 1 year.
        ongoingMonitoring: {
          ftdDate: '2026-01-05T00:00:00Z',
          financialSustainability: 5000,
          copyUtilization: 0,
          manuallyUnblocked: false,
        },
        suitabilityCalculationDetails: hardBlockedTree(),
      },
      productNegativeMarkets: cysecNmProducts('Blocked'),
    },
  },

  1003: {
    description: 'FCA — scored Medium-High, then blocked by ongoing monitoring',
    cid: 9003,
    username: 'fixture_monitoring',
    profile: {
      gcid: 1003,
      regulation: 'FCA',
      countryId: 77,
      verificationLevel: 2,
      configurationVersion: 15,
      recalculationReason: 8,
      updatedOn: '2026-08-10T02:00:00Z',
      lastAnswerOccurredAt: '2026-03-01T11:00:00Z',
      questionsAnswers: [
        ...ANSWERS_WORKED_EXAMPLE,
        ...monitoringAnswers('Between10KAnd50K', 'Between50KAnd200K', 'AnswerBetween20KAnd50K'),
      ],
      suitability: {
        clientRiskLevel: LEVEL.MediumHigh,
        suitabilityBlock: BLOCK.NotBlocked,
        isAllQuestionsAnswered: true,
        // Why this user is stopped, in one line: they deposited for the first time this year, so
        // the declared plan has only had one year to accumulate. 50% x 35,000 x 1 = 17,500, well
        // under the 77,500 their income and assets would have allowed, and under the 19,500 they
        // already have at risk.
        ongoingMonitoring: {
          ftdDate: '2026-01-20T00:00:00Z',
          financialSustainability: 17500,
          copyUtilization: 19500,
          manuallyUnblocked: false,
        },
        suitabilityCalculationDetails: fcaWorkedExampleTree(),
      },
    },
  },

  1004: {
    description: 'CySEC — below verification level 2, so not assessed rather than Minimal',
    cid: 9004,
    username: 'fixture_unverified',
    profile: {
      gcid: 1004,
      regulation: 'CySEC',
      countryId: 56,
      verificationLevel: 1,
      configurationVersion: 24,
      recalculationReason: 3,
      updatedOn: '2026-05-20T08:30:00Z',
      lastAnswerOccurredAt: '2026-05-20T08:29:00Z',
      questionsAnswers: [{ questionId: Q.TradingPurpose, answerIds: [a('AdditionalRevenues')] }],
      suitability: null,
    },
  },

  1005: {
    description: 'CySEC — internal eToro account, scoring bypassed and the tree empty by design',
    cid: 9005,
    username: 'fixture_etorian',
    profile: {
      gcid: 1005,
      regulation: 'CySEC',
      countryId: 250,
      verificationLevel: 3,
      configurationVersion: 24,
      recalculationReason: 1,
      updatedOn: '2026-08-01T00:00:00Z',
      lastAnswerOccurredAt: null,
      questionsAnswers: [],
      suitability: {
        clientRiskLevel: LEVEL.High,
        suitabilityBlock: BLOCK.NotBlocked,
        isAllQuestionsAnswered: true,
        ongoingMonitoring: { manuallyUnblocked: true },
        suitabilityCalculationDetails: [],
      },
    },
  },

  1006: {
    description: 'MAS — stopped scoring at v3, so the stored profile has no suitability at all',
    cid: 9006,
    username: 'fixture_mas',
    profile: {
      gcid: 1006,
      regulation: 'MAS',
      countryId: 183,
      verificationLevel: 3,
      configurationVersion: 12,
      recalculationReason: 2,
      updatedOn: '2026-04-14T13:45:00Z',
      lastAnswerOccurredAt: '2026-04-14T13:40:00Z',
      questionsAnswers: ANSWERS_WORKED_EXAMPLE,
      // Not an empty Suitability object — the whole property is absent from the stored
      // document for these users, which is why the source type allows null.
      suitability: null,
    },
  },

  1007: {
    description: 'FCA — older configuration whose tree leaves carry no Question field',
    cid: 9007,
    username: 'fixture_nameonly',
    profile: {
      gcid: 1007,
      regulation: 'FCA',
      countryId: 77,
      verificationLevel: 2,
      configurationVersion: 14,
      recalculationReason: 4,
      updatedOn: '2026-07-30T10:00:00Z',
      lastAnswerOccurredAt: '2026-07-30T09:58:00Z',
      questionsAnswers: [
        ...ANSWERS_WORKED_EXAMPLE,
        ...monitoringAnswers('Between10KAnd50K', 'Between50KAnd200K', 'AnswerBetween50KAnd200K'),
      ],
      suitability: {
        clientRiskLevel: LEVEL.MediumHigh,
        suitabilityBlock: BLOCK.NotBlocked,
        isAllQuestionsAnswered: true,
        // Seven years of deposits behind them, so the intent path has grown to 437,500 and their
        // income and assets are what caps them: 50% x 30,000 + 50% x 125,000 = 77,500.
        ongoingMonitoring: {
          ftdDate: '2020-09-30T00:00:00Z',
          financialSustainability: 77500,
          copyUtilization: 1000,
        },
        suitabilityCalculationDetails: fcaWorkedExampleTree({ omitQuestionField: true }),
      },
    },
  },

  1008: {
    description: 'No stored profile at all — the engine never ran for this user',
    cid: 9008,
    username: 'fixture_missing',
    profile: null,
  },

  1009: {
    description: 'CySEC — answered with an option no configuration scores, the funnel/config gap',
    cid: 9009,
    username: 'fixture_unscored',
    profile: {
      gcid: 1009,
      regulation: 'CySEC',
      countryId: 56,
      verificationLevel: 2,
      configurationVersion: 24,
      recalculationReason: 4,
      updatedOn: '2026-08-05T12:20:00Z',
      lastAnswerOccurredAt: '2026-08-05T12:18:00Z',
      questionsAnswers: [
        ...ANSWERS_WITH_UNSCORED,
        ...monitoringAnswers('UpTo10K', 'Between50KAnd200K', 'AnswerBetween20KAnd50K'),
      ],
      suitability: {
        clientRiskLevel: LEVEL.Medium,
        suitabilityBlock: BLOCK.NotBlocked,
        isAllQuestionsAnswered: true,
        // Balance sheet 50% x 5,000 + 50% x 125,000 = 65,000; intent 50% x 35,000 x 3 = 52,500.
        ongoingMonitoring: {
          ftdDate: '2024-04-16T00:00:00Z',
          financialSustainability: 52500,
          copyUtilization: 2000,
        },
        suitabilityCalculationDetails: unscoredIncomeTree(),
      },
    },
  },

  1010: {
    description: 'CySEC — live v23 shape, an experienced trader capped at Low by Factor A',
    cid: 9010,
    username: 'fixture_live_shape',
    profile: {
      gcid: 1010,
      regulation: 'CySEC',
      countryId: 57,
      verificationLevel: 3,
      configurationVersion: 23,
      recalculationReason: 4,
      updatedOn: '2026-07-07T07:55:52Z',
      lastAnswerOccurredAt: '2026-07-07T07:55:51Z',
      questionsAnswers: [
        ...ANSWERS_LIVE_SHAPE,
        ...monitoringAnswers('Between200KTo500K', 'Between500KTo1M', 'AnswerBetween20KAnd50K'),
      ],
      suitability: {
        clientRiskLevel: LEVEL.Low,
        suitabilityBlock: BLOCK.NotBlocked,
        isAllQuestionsAnswered: true,
        // A wealthy user whose own modest declared deposit is the binding constraint: their
        // balance sheet allows 550,000, but 50% x 35,000 over ten years of deposits is 175,000.
        //
        // The live document carried no copyUtilization, which is normal for a user who has
        // not copied anyone yet — so the gate has a limit and nothing to compare it against.
        ongoingMonitoring: {
          ftdDate: '2017-05-02T00:00:00Z',
          financialSustainability: 175000,
          manuallyUnblocked: false,
        },
        suitabilityCalculationDetails: liveCysec23Tree(),
      },
    },
  },

  1011: {
    description: 'ASIC — scored Medium-High on six components, with no MiCA assessment',
    cid: 9011,
    username: 'fixture_asic',
    profile: {
      gcid: 1011,
      regulation: 'ASIC',
      countryId: 13,
      verificationLevel: 2,
      configurationVersion: 9,
      recalculationReason: 4,
      updatedOn: '2026-07-18T04:31:00Z',
      lastAnswerOccurredAt: '2026-07-18T04:29:00Z',
      questionsAnswers: [...ANSWERS_ASIC, ...depositAnswer('AnswerBetween50KAnd200K')],
      suitability: {
        clientRiskLevel: LEVEL.MediumHigh,
        suitabilityBlock: BLOCK.NotBlocked,
        isAllQuestionsAnswered: true,
        // Balance sheet 50% x 125,000 + 50% x 350,000 = 237,500; intent 50% x 125,000 x 3 =
        // 187,500.
        ongoingMonitoring: {
          ftdDate: '2024-06-01T00:00:00Z',
          financialSustainability: 187500,
          copyUtilization: 24000,
          manuallyUnblocked: false,
        },
        suitabilityCalculationDetails: asicTree(),
      },
    },
  },

  1012: {
    description: 'ASICGAML — hard blocked by the fifth condition no other regulation has',
    cid: 9012,
    username: 'fixture_gaml',
    profile: {
      gcid: 1012,
      regulation: 'ASICGAML',
      countryId: 13,
      verificationLevel: 3,
      configurationVersion: 15,
      recalculationReason: 4,
      updatedOn: '2026-08-03T22:10:00Z',
      lastAnswerOccurredAt: '2026-08-03T22:07:00Z',
      questionsAnswers: [...ANSWERS_GAML_BLOCKED, ...depositAnswer('AnswerBetween20KAnd50K')],
      suitability: {
        clientRiskLevel: LEVEL.Low,
        suitabilityBlock: BLOCK.Blocked,
        isAllQuestionsAnswered: true,
        // Balance sheet 50% x 30,000 + 50% x 5,000 = 17,500, against an intent of 35,000.
        ongoingMonitoring: {
          ftdDate: '2025-11-12T00:00:00Z',
          financialSustainability: 17500,
          copyUtilization: 0,
          manuallyUnblocked: false,
        },
        suitabilityCalculationDetails: gamlTree(),
      },
      productNegativeMarkets: {
        Cfd: nmProduct('Blocked', [
          nmRule('KnockOut', 'Blocked'),
          nmRule('TradingExperience', 'NotBlocked'),
          nmRule('CfdRiskAssessment', 'NotBlocked'),
        ], 15),
        ExperimentalCrypto: nmProduct('NotBlocked', [nmRule('KnockOut', 'NotBlocked')], 15),
      },
    },
  },

  1013: {
    description: 'FSRA — three unanswered questions sit on the default and cost a level',
    cid: 9013,
    username: 'fixture_fsra',
    profile: {
      gcid: 1013,
      regulation: 'FSRA',
      countryId: 231,
      verificationLevel: 2,
      configurationVersion: 10,
      recalculationReason: 4,
      updatedOn: '2026-06-29T11:46:00Z',
      lastAnswerOccurredAt: '2026-06-29T11:44:00Z',
      // `UpTo20K` is the lowest band the deposit question offers and the one band with no entry in
      // this app's copy of the CCM amount table. The stored limit proves the engine priced it, so
      // the gap is on our side — which is the state this example is here to render.
      questionsAnswers: [...ANSWERS_FSRA_INCOMPLETE, ...depositAnswer('UpTo20K')],
      suitability: {
        clientRiskLevel: LEVEL.MediumHigh,
        suitabilityBlock: BLOCK.NotBlocked,
        // The engine scored anyway. Three questions are missing, and their components took the
        // configured default rather than the result being withheld.
        isAllQuestionsAnswered: false,
        ongoingMonitoring: {
          ftdDate: '2022-02-08T00:00:00Z',
          financialSustainability: 210000,
          manuallyUnblocked: false,
        },
        suitabilityCalculationDetails: fsraTree(),
      },
    },
  },

  1014: {
    description:
      'CySEC — blocked by monitoring against a limit this app cannot reproduce, the CCM drift case',
    cid: 9014,
    username: 'fixture_ccm_drift',
    profile: {
      gcid: 1014,
      regulation: 'CySEC',
      countryId: 56,
      verificationLevel: 2,
      configurationVersion: 24,
      // The nightly monitoring job, which is the only reason this profile was rewritten.
      recalculationReason: 8,
      updatedOn: '2026-08-12T02:14:00Z',
      lastAnswerOccurredAt: '2026-02-19T15:31:00Z',
      questionsAnswers: [
        ...ANSWERS_WORKED_EXAMPLE,
        ...monitoringAnswers('Between50KAnd200K', 'Between200KTo500K', 'AnswerBetween50KAnd200K'),
      ],
      suitability: {
        clientRiskLevel: LEVEL.Medium,
        suitabilityBlock: BLOCK.NotBlocked,
        isAllQuestionsAnswered: true,
        // The deliberate disagreement, and the reason the app never recomputes its way past a
        // stored figure. Our weightings give a balance sheet of 237,500; the stored limit is
        // exactly half that, which is what a production `IncomeSuitabilityWeighting` and
        // `CashAndLiquidAssetsSuitabilityWeighting` of 0.25 would produce.
        //
        // The consequence is the point: at 150,000 utilised this user is blocked under the stored
        // limit and comfortably inside the reconstructed one. An app that trusted its own
        // arithmetic would tell a compliance reader the opposite of what happened.
        ongoingMonitoring: {
          ftdDate: '2023-07-04T00:00:00Z',
          financialSustainability: 118750,
          copyUtilization: 150000,
          manuallyUnblocked: false,
        },
        suitabilityCalculationDetails: workedExampleTree(),
      },
    },
  },
};

export class FixtureSource implements ProfileSource {
  readonly id = 'fixtures';
  readonly label = 'Examples (synthetic, no real data)';
  readonly isRealData = false;
  readonly capabilities: SourceCapabilities = { tree: true, answers: true };

  async resolve(id: number, kind: IdKind): Promise<Resolution> {
    const asGcid = FIXTURES[id];
    const cidMatch = Object.entries(FIXTURES).find(([, f]) => f.cid === id);

    // Reported for the same reason the real source reports it: so an operator who picked the
    // wrong id type is told so, rather than told the user does not exist.
    const alsoValidAs: OtherSpace[] = [];
    if (kind !== 'gcid' && asGcid) alsoValidAs.push('gcid');
    if (kind !== 'cid' && cidMatch) alsoValidAs.push('cid');

    if (kind === 'gcid' && asGcid) {
      return {
        kind: 'resolved',
        user: { gcid: id, cid: asGcid.cid ?? null, username: asGcid.username ?? null },
        via: 'gcid',
        alsoValidAs,
      };
    }
    if (kind === 'cid' && cidMatch) {
      const [gcid, f] = cidMatch;
      return {
        kind: 'resolved',
        user: { gcid: Number(gcid), cid: id, username: f.username ?? null },
        via: 'cid',
        alsoValidAs,
      };
    }
    return { kind: 'not-found', id, tried: kind, alsoValidAs };
  }

  async getProfile(gcid: number): Promise<RawProfile | null> {
    return FIXTURES[gcid]?.profile ?? null;
  }

  async list() {
    return Object.entries(FIXTURES).map(([gcid, f]) => ({
      gcid: Number(gcid),
      description: f.description,
    }));
  }
}
