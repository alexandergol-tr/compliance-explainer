import { describe, expect, it } from 'vitest';
import type { ConfigComponent, ConfigFactor, LoadedConfig, RiskLevelWeight } from '@/config/types';
import { explainTree } from './arithmetic';
import type { LeafExplanation } from './leaf';
import type { TreeNode } from './tree';

const DOCUMENT_SCALE: RiskLevelWeight[] = [
  { RiskLevel: 'High', Weight: 4 },
  { RiskLevel: 'MediumHigh', Weight: 3 },
  { RiskLevel: 'Medium', Weight: 2 },
  { RiskLevel: 'Low', Weight: 1 },
  { RiskLevel: 'Minimal', Weight: 0 },
];

/** Question 8's scoring, transcribed verbatim from config-prod/CySEC-24.json. */
const TRADING_PURPOSE: ConfigComponent = {
  Name: '5',
  Operation: 'Max',
  RiskLevelWeight: null,
  QuestionAnswers: [
    {
      Question: 'TradingPurpose',
      IsRequiredForCopy: true,
      Answers: [
        { Answer: 'ShortTermReturns', RiskLevel: 'High' },
        { Answer: 'AdditionalRevenues', RiskLevel: 'MediumHigh' },
        { Answer: 'FuturePlanning', RiskLevel: 'Medium' },
        { Answer: 'SavingsForHome', RiskLevel: 'Medium' },
        { Answer: 'PurposeInvestments', RiskLevel: 'Low' },
        { Answer: 'PurposeTrading', RiskLevel: 'Medium' },
        { Answer: 'PurposeCryptoToFiat', RiskLevel: 'High' },
      ],
      WeigthAnswers: [],
    },
  ],
};

/**
 * Component 8's scoring, transcribed verbatim from config-prod/CySEC-24.json — both the legacy
 * `Answers` set and the current weighted group, because the engine holds both at once.
 */
const KNOWLEDGE_ASSESSMENT: ConfigComponent = {
  Name: '8',
  Operation: 'Max',
  RiskLevelWeight: null,
  QuestionAnswers: [
    {
      Question: 'TradingKnowledgeAssessment',
      IsRequiredForCopy: false,
      Answers: [
        { Answer: 'Leverage', RiskLevel: 'Medium' },
        { Answer: 'MarginCall', RiskLevel: 'Medium' },
        { Answer: 'Cfd', RiskLevel: 'High' },
        { Answer: 'StopLoss', RiskLevel: 'Medium' },
      ],
      WeigthAnswers: [
        {
          Answers: [
            { Answer: 'NewerLeverage', Score: 2 },
            { Answer: 'NewerCfd', Score: -2 },
            { Answer: 'NewerMarginCall', Score: 2 },
            { Answer: 'NewerStopLossTrigger', Score: -2 },
            { Answer: 'NewerStopLossGapThrough', Score: -2 },
            { Answer: 'NewerCfdTrs', Score: -2 },
          ],
          QuestionScoreToRiskLevelMappings: [
            { RiskLevel: 'High', MinTotalScore: 6 },
            { RiskLevel: 'MediumHigh', MinTotalScore: 2 },
            { RiskLevel: 'Medium', MinTotalScore: -6 },
            { RiskLevel: 'Low', MinTotalScore: -100 },
          ],
          QuestionScoreToBlockResultMappings: [],
        },
      ],
    },
  ],
};

/** Component 1's first question — multi-select in the funnel, so it exercises the combining. */
const EQUITIES: ConfigComponent = {
  Name: '1',
  Operation: 'Max',
  RiskLevelWeight: null,
  QuestionAnswers: [
    {
      Question: 'Equities',
      IsRequiredForCopy: true,
      Answers: [
        { Answer: 'NeverTraded', RiskLevel: 'Medium' },
        { Answer: 'ZeroTo10', RiskLevel: 'Medium' },
        { Answer: 'TenTo20', RiskLevel: 'MediumHigh' },
        { Answer: 'Above20', RiskLevel: 'High' },
      ],
      WeigthAnswers: [],
    },
  ],
};

function config(components: ConfigComponent[], defaultRiskLevel = 'Medium' as const): LoadedConfig {
  const factor: ConfigFactor = {
    Name: 'A',
    Operation: 'Min',
    Round: 0,
    RevolvingDoorOrder: 1,
    Components: components,
  };
  return {
    id: 'CySEC-24',
    regulation: 'CySEC',
    version: 24,
    updatedOn: null,
    scoresSuitability: true,
    defaultRiskLevel,
    rootOperation: 'Min',
    rootRounding: null,
    riskLevelWeight: DOCUMENT_SCALE,
    factors: [factor],
    scoreMappings: {},
    blockChecks: [],
    blockDefaultResult: null,
  };
}

function question(
  rawName: string,
  questionId: number,
  riskLevel: TreeNode['riskLevel'],
): TreeNode {
  return {
    id: 'q',
    level: 'question',
    rawName,
    title: rawName,
    riskLevel,
    questionId,
    questionLabel: null,
    revolvingDoorOrder: null,
    children: [],
  };
}

function tree(componentName: string, leaf: TreeNode, componentLevel: TreeNode['riskLevel']): TreeNode[] {
  return [
    {
      id: 'f',
      level: 'factor',
      rawName: 'A',
      title: 'Factor A',
      riskLevel: componentLevel,
      questionId: null,
      questionLabel: null,
      revolvingDoorOrder: 1,
      children: [
        {
          id: 'c',
          level: 'component',
          rawName: componentName,
          title: `Component ${componentName}`,
          riskLevel: componentLevel,
          questionId: null,
          questionLabel: null,
          revolvingDoorOrder: null,
          children: [{ ...leaf, id: 'f.c.q' }],
        },
      ],
    },
  ];
}

function leafOf(explanation: ReturnType<typeof explainTree>): LeafExplanation {
  const leaf = explanation.leafByNodeId.get('f.c.q');
  if (!leaf) throw new Error('no leaf explanation was produced');
  return leaf;
}

describe('per-answer scoring', () => {
  it('names the answer the customer picked and the level it earned', () => {
    const explanation = explainTree(
      tree('5', question('TradingPurpose', 8, 'Low'), 'Low'),
      'Low',
      config([TRADING_PURPOSE]),
      [{ questionId: 8, answerIds: [900] }],
    );
    const leaf = leafOf(explanation);

    expect(leaf.route).toBe('per-answer');
    expect(leaf.selected).toHaveLength(1);
    expect(leaf.selected[0].copy.text).toBe('Investments/Savings');
    expect(leaf.selected[0].configuredLevel).toBe('Low');
    expect(leaf.computed).toBe('Low');
    expect(leaf.agrees).toBe(true);
    expect(leaf.summary).toContain('Investments/Savings');
  });

  it('flags an answer the funnel offers but the configuration does not score', () => {
    // a903, "Crypto trading and/or conversion". Offered under CySEC, absent from CySEC-24, so the
    // engine silently applies the default and raises nothing anywhere.
    const explanation = explainTree(
      tree('5', question('TradingPurpose', 8, 'Medium'), 'Medium'),
      'Medium',
      config([TRADING_PURPOSE]),
      [{ questionId: 8, answerIds: [903] }],
    );
    const leaf = leafOf(explanation);

    expect(leaf.selected[0].usedDefault).toBe(true);
    expect(leaf.computed).toBe('Medium');
    expect(leaf.notes.join(' ')).toContain('not listed by this');
    // The summary must not claim the configuration scores it. It does not, and reading that the
    // configuration "scores Medium" is how a config gap gets mistaken for a deliberate rating.
    expect(leaf.summary).toContain('does not score');
    expect(leaf.summary).not.toContain('scores Medium');
  });

  it('combines a multi-select with the component operation, not one of its own', () => {
    // Questions have no operation; `CalculateQuestionResult` is handed the component's.
    // a122 `ZeroTo10` -> Medium, a124 `Above20` -> High, so Max is High.
    const explanation = explainTree(
      tree('1', question('Equities', 33, 'High'), 'High'),
      'High',
      config([EQUITIES]),
      [{ questionId: 33, answerIds: [122, 124] }],
    );
    const leaf = leafOf(explanation);

    expect(leaf.operation).toBe('Max');
    expect(leaf.selected.map((a) => a.configuredLevel)).toEqual(['Medium', 'High']);
    expect(leaf.computed).toBe('High');
  });

  it('defaults an answer belonging to a different question rather than matching it loosely', () => {
    // a140 is `Above2000`, an amount answer for question 47. It is a real enum member, so the
    // engine's cast succeeds and only the per-question answer list rejects it.
    const explanation = explainTree(
      tree('1', question('Equities', 33, 'Medium'), 'Medium'),
      'Medium',
      config([EQUITIES]),
      [{ questionId: 33, answerIds: [140] }],
    );
    const leaf = leafOf(explanation);

    expect(leaf.selected[0].configuredLevel).toBeNull();
    expect(leaf.selected[0].usedDefault).toBe(true);
    expect(leaf.computed).toBe('Medium');
  });

  it('takes the default when nothing was answered, without pretending an answer exists', () => {
    const explanation = explainTree(
      tree('5', question('TradingPurpose', 8, 'Medium'), 'Medium'),
      'Medium',
      config([TRADING_PURPOSE]),
      [],
    );
    const leaf = leafOf(explanation);

    expect(leaf.route).toBe('default');
    expect(leaf.selected).toEqual([]);
    expect(leaf.computed).toBe('Medium');
    expect(leaf.summary).toContain('No answer on record');
  });

  it('prefers the component default over the document default', () => {
    const explanation = explainTree(
      tree('5', question('TradingPurpose', 8, 'Minimal'), 'Minimal'),
      'Minimal',
      config([{ ...TRADING_PURPOSE, DefaultRiskLevel: 'Minimal' }]),
      [],
    );
    expect(leafOf(explanation).computed).toBe('Minimal');
  });

  it('reports a disagreement rather than hiding it', () => {
    const explanation = explainTree(
      tree('5', question('TradingPurpose', 8, 'High'), 'High'),
      'High',
      config([TRADING_PURPOSE]),
      [{ questionId: 8, answerIds: [900] }],
    );
    const leaf = leafOf(explanation);

    expect(leaf.computed).toBe('Low');
    expect(leaf.stored).toBe('High');
    expect(leaf.agrees).toBe(false);
    expect(explanation.warnings.join(' ')).toContain('do not reproduce from the answers on record');
  });

  it('says so plainly when the question is absent from the configuration on screen', () => {
    const explanation = explainTree(
      tree('5', question('RiskAppetite', 9, 'Medium'), 'Medium'),
      'Medium',
      config([TRADING_PURPOSE]),
      [{ questionId: 9, answerIds: [25] }],
    );
    const leaf = leafOf(explanation);

    expect(leaf.route).toBe('not-in-config');
    expect(leaf.computed).toBeNull();
    // An unknown is not a disagreement — claiming one would manufacture a defect.
    expect(leaf.agrees).toBe(true);
  });
});

describe('component 8 weighted scoring', () => {
  const answered = (answerIds: number[], stored: TreeNode['riskLevel']) =>
    leafOf(
      explainTree(
        tree('8', question('TradingKnowledgeAssessment', 23, stored), stored),
        stored,
        config([KNOWLEDGE_ASSESSMENT]),
        [{ questionId: 23, answerIds }],
      ),
    );

  it('credits unselected statements too, which is what makes the total reachable', () => {
    // Both correct statements selected, none of the incorrect ones. Every one of the six
    // contributes +2, including the retired sixth, so the total is the maximum of 12.
    const leaf = answered([142, 144], 'High');

    expect(leaf.route).toBe('weighted');
    expect(leaf.weighted?.total).toBe(12);
    expect(leaf.weighted?.band).toBe('High');
    expect(leaf.weighted?.bandFloor).toBe(6);
    expect(leaf.computed).toBe('High');
    expect(leaf.weighted?.statements.every((s) => s.contribution === 2)).toBe(true);
  });

  it('bands the worst possible answer as Low', () => {
    // Every incorrect statement selected, neither correct one. Five judgments wrong at -2, plus
    // the retired statement's unconditional +2.
    const leaf = answered([143, 145, 146], 'Low');
    expect(leaf.weighted?.total).toBe(-8);
    expect(leaf.weighted?.band).toBe('Low');
  });

  it('bands a middling answer', () => {
    // Three of the five live judgments right: 142 correctly selected (+2), 143 wrongly selected
    // (-2), 144 wrongly left alone (-2), 145 and 146 correctly left alone (+2 each), plus the
    // retired statement's +2. Total 4, which is the MediumHigh band.
    const leaf = answered([142, 143], 'MediumHigh');
    expect(leaf.weighted?.total).toBe(4);
    expect(leaf.weighted?.band).toBe('MediumHigh');
  });

  it('misses one correct statement and still bands High, because the thresholds are wide', () => {
    // Four of five judgments right scores 6, and the retired statement lifts it to 8. Both sides
    // of that +2 land in the same band, which is why the retired statement changes no outcome
    // today — the reachable totals are four apart and the band floors sit between them.
    const leaf = answered([142], 'High');
    expect(leaf.weighted?.total).toBe(8);
    expect(leaf.weighted?.band).toBe('High');
  });

  it('flags the statement that is scored but can never be selected', () => {
    const leaf = answered([142, 144], 'High');

    expect(leaf.weighted?.retired.map((s) => s.identifier)).toEqual(['NewerCfdTrs']);
    const retired = leaf.weighted!.retired[0];
    expect(retired.selected).toBe(false);
    expect(retired.offered).toBe(false);
    // Score -2, unselected, so it adds +2 to every total that will ever be computed.
    expect(retired.contribution).toBe(2);
    expect(leaf.notes.join(' ')).toContain('no longer offered in the funnel');
  });

  it('falls through to the legacy answer set when no weighted statement was selected', () => {
    // How one document carries two generations of Component 8: a user who answered with the old
    // ids selects none of the weighted statements, the group yields nothing, and the engine uses
    // `Answers` instead. Reporting a weighted total here would be fiction.
    const leaf = answered([86], 'High');

    expect(leaf.route).toBe('per-answer');
    expect(leaf.weighted).toBeNull();
    expect(leaf.selected[0].configuredLevel).toBe('High');
    expect(leaf.computed).toBe('High');
  });
});
