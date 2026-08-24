import { describe, expect, it } from 'vitest';
import type { ConfigFactor, LoadedConfig, RiskLevelWeight } from '@/config/types';
import { explainTree, roundHalfToEven } from './arithmetic';
import type { TreeNode } from './tree';

/** The document scale every live config declares. */
const DOCUMENT_SCALE: RiskLevelWeight[] = [
  { RiskLevel: 'High', Weight: 4 },
  { RiskLevel: 'MediumHigh', Weight: 3 },
  { RiskLevel: 'Medium', Weight: 2 },
  { RiskLevel: 'Low', Weight: 1 },
  { RiskLevel: 'Minimal', Weight: 0 },
];

/** Component 9's own scale — the only one in production that has one. */
const COMPONENT_SCALE: RiskLevelWeight[] = [
  { RiskLevel: 'High', Weight: 500 },
  { RiskLevel: 'MediumHigh', Weight: 400 },
  { RiskLevel: 'Medium', Weight: 300 },
  { RiskLevel: 'Low', Weight: 200 },
  { RiskLevel: 'Minimal', Weight: 100 },
];

function node(
  id: string,
  rawName: string,
  riskLevel: TreeNode['riskLevel'],
  children: TreeNode[] = [],
): TreeNode {
  return {
    id,
    level: children.length > 0 ? 'factor' : 'question',
    rawName,
    title: rawName,
    riskLevel,
    questionId: null,
    questionLabel: null,
    revolvingDoorOrder: null,
    children,
  };
}

function config(factors: ConfigFactor[]): LoadedConfig {
  return {
    id: 'CySEC-24',
    regulation: 'CySEC',
    version: 24,
    updatedOn: null,
    scoresSuitability: true,
    defaultRiskLevel: 'Medium',
    rootOperation: 'Min',
    rootRounding: null,
    riskLevelWeight: DOCUMENT_SCALE,
    factors,
    scoreMappings: {},
    blockChecks: [],
    blockDefaultResult: null,
  };
}

function factor(name: string, operation: 'Min' | 'Max' | 'Avg', components: ConfigFactor['Components']): ConfigFactor {
  return {
    Name: name,
    Operation: operation,
    Round: operation === 'Avg' ? 'Down' : 0,
    RevolvingDoorOrder: 1,
    Components: components,
  };
}

describe('roundHalfToEven', () => {
  it('matches Convert.ToInt32, which breaks ties towards even rather than up', () => {
    expect(roundHalfToEven(2.5)).toBe(2);
    expect(roundHalfToEven(3.5)).toBe(4);
    expect(roundHalfToEven(2.4)).toBe(2);
    expect(roundHalfToEven(2.6)).toBe(3);
  });
});

describe('explainTree', () => {
  it('reproduces the live CySEC v24 profile exactly, node for node', () => {
    // Every level below is what the engine stored for GCID 48749227, verified against Cosmos.
    const tree = [
      node('0', 'A', 'MediumHigh', [
        node('0.0', '5', 'MediumHigh', [node('0.0.0', 'TradingPurpose', 'MediumHigh')]),
        node('0.1', '6', 'High', [node('0.1.0', 'RiskAppetite', 'High')]),
      ]),
      node('1', 'B', 'Medium', [
        node('1.0', '1', 'High', [
          node('1.0.0', 'Equities', 'High'),
          node('1.0.1', 'Crypto', 'Medium'),
          node('1.0.2', 'LeveragedCfd', 'Medium'),
        ]),
        node('1.1', '2', 'Medium', [
          node('1.1.0', 'EquitiesInvestedAmount', 'Medium'),
          node('1.1.1', 'CryptoInvestedAmount', 'Medium'),
          node('1.1.2', 'LeveragedCfdInvestedAmount', 'Medium'),
        ]),
        node('1.2', '3', 'Medium', [node('1.2.0', 'TradingKnowledge', 'Medium')]),
        node('1.3', '4', 'Medium', [node('1.3.0', 'TradingStrategy', 'Medium')]),
        node('1.4', '7', 'High', [node('1.4.0', 'IncomeSource', 'High')]),
        node('1.5', '8', 'Medium', [node('1.5.0', 'TradingKnowledgeAssessment', 'Medium')]),
        node('1.6', '9', 'High', [
          node('1.6.0', 'MiCACryptoAssessmentHighVolatility', 'High'),
          node('1.6.1', 'MiCACryptoAssessmentCyberRisks', 'High'),
          node('1.6.2', 'MiCACryptoAssessmentRecoverLoss', 'High'),
          node('1.6.3', 'MiCACryptoAssessmentInvestingRisks', 'High'),
          node('1.6.4', 'MiCACryptoAssessmentPrivateKey', 'High'),
        ]),
      ]),
    ];

    const component = (name: string, operation: 'Max' | 'Avg', ownScale = false) => ({
      Name: name,
      Operation: operation,
      Round: operation === 'Avg' ? ('Down' as const) : (0 as const),
      QuestionAnswers: null,
      RiskLevelWeight: ownScale ? COMPONENT_SCALE : [],
    });

    const explanation = explainTree(
      tree,
      'Medium',
      config([
        factor('A', 'Min', [component('5', 'Max'), component('6', 'Max')]),
        factor('B', 'Avg', [
          component('1', 'Max'),
          component('2', 'Max'),
          component('3', 'Max'),
          component('4', 'Max'),
          component('7', 'Max'),
          component('8', 'Max'),
          component('9', 'Avg', true),
        ]),
      ]),
    );

    expect(explanation.warnings).toEqual([]);
    for (const [id, aggregation] of explanation.byNodeId) {
      expect(aggregation.agrees, `${id} should reproduce`).toBe(true);
    }
    expect(explanation.root?.agrees).toBe(true);

    // Factor B is the case that discriminates truncation from rounding to nearest: the mean is
    // 2.857, which floors to Medium but would round to Medium-High.
    const factorB = explanation.byNodeId.get('1');
    expect(factorB?.mean).toBeCloseTo(2.857, 3);
    expect(factorB?.computed).toBe('Medium');
    expect(factorB?.summary).toBe(
      'Average of the 7 components, weighted — (4 + 2 + 2 + 2 + 4 + 2 + 4) ÷ 7 = 2.857, rounded down to 2.',
    );

    // Component 9 averages on its own 100..500 scale, not the document's 0..4.
    const component9 = explanation.byNodeId.get('1.6');
    expect(component9?.scale).toBe('component');
    expect(component9?.inputs.every((i) => i.weight === 500)).toBe(true);
    expect(component9?.computed).toBe('High');

    expect(explanation.root?.summary).toBe('Lowest of the 2 factors — Medium-High, Medium.');
    expect(explanation.root?.computed).toBe('Medium');
  });

  it('uses the document scale for Max even when the component declares its own', () => {
    // GetMin/GetMax on the nested configuration delegate to the flat one, so a component scale
    // is invisible to them. No live component exercises this, which is exactly why it is pinned.
    const tree = [
      node('0', 'A', 'High', [
        node('0.0', '9', 'High', [node('0.0.0', 'Q1', 'High'), node('0.0.1', 'Q2', 'Low')]),
      ]),
    ];

    const explanation = explainTree(
      tree,
      'High',
      config([
        factor('A', 'Min', [
          { Name: '9', Operation: 'Max', Round: 0, QuestionAnswers: null, RiskLevelWeight: COMPONENT_SCALE },
        ]),
      ]),
    );

    const component = explanation.byNodeId.get('0.0');
    expect(component?.scale).toBe('document');
    expect(component?.inputs.map((i) => i.weight)).toEqual([4, 1]);
    expect(component?.computed).toBe('High');
  });

  it('flags a node that does not reproduce instead of hiding it', () => {
    const tree = [
      node('0', 'A', 'Low', [
        node('0.0', '5', 'High', [node('0.0.0', 'TradingPurpose', 'High')]),
        node('0.1', '6', 'High', [node('0.1.0', 'RiskAppetite', 'High')]),
      ]),
    ];

    const explanation = explainTree(
      tree,
      'Low',
      config([
        factor('A', 'Min', [
          { Name: '5', Operation: 'Max', Round: 0, QuestionAnswers: null, RiskLevelWeight: [] },
          { Name: '6', Operation: 'Max', Round: 0, QuestionAnswers: null, RiskLevelWeight: [] },
        ]),
      ]),
    );

    // Min(High, High) is High, but the engine stored Low for the factor.
    expect(explanation.byNodeId.get('0')?.agrees).toBe(false);
    expect(explanation.byNodeId.get('0')?.computed).toBe('High');
    expect(explanation.warnings.join(' ')).toContain('do not reproduce');
  });

  it('says so when the tree has nodes the configuration does not know about', () => {
    const tree = [node('0', 'C', 'Medium', [node('0.0', '1', 'Medium')])];

    const explanation = explainTree(
      tree,
      'Medium',
      config([factor('A', 'Min', [])]),
    );

    expect(explanation.byNodeId.size).toBe(0);
    expect(explanation.warnings.join(' ')).toContain('no counterpart');
  });

  it('returns nothing rather than guessing when no configuration is loaded', () => {
    const tree = [node('0', 'A', 'Medium', [node('0.0', '1', 'Medium')])];
    const explanation = explainTree(tree, 'Medium', null);

    expect(explanation.byNodeId.size).toBe(0);
    expect(explanation.root).toBeNull();
    expect(explanation.warnings).toEqual([]);
  });

  /** Two components at Medium and one at High: mean 2.667, which the two branches split on. */
  function fractionalMeanTree(storedFactorLevel: TreeNode['riskLevel']): TreeNode[] {
    return [
      node('0', 'A', storedFactorLevel, [
        node('0.0', '1', 'Medium', [node('0.0.0', 'Q1', 'Medium')]),
        node('0.1', '2', 'Medium', [node('0.1.0', 'Q2', 'Medium')]),
        node('0.2', '3', 'High', [node('0.2.0', 'Q3', 'High')]),
      ]),
    ];
  }

  function averagingFactor(round: ConfigFactor['Round']): ConfigFactor {
    return {
      Name: 'A',
      Operation: 'Avg',
      Round: round,
      RevolvingDoorOrder: 1,
      Components: ['1', '2', '3'].map((name) => ({
        Name: name,
        Operation: 'Max' as const,
        Round: 0 as const,
        QuestionAnswers: null,
        RiskLevelWeight: [],
      })),
    };
  }

  it('rounds a fractional average up on the non-Down branch', () => {
    const explanation = explainTree(
      fractionalMeanTree('MediumHigh'),
      'MediumHigh',
      config([averagingFactor('Up')]),
    );

    const factorA = explanation.byNodeId.get('0');
    expect(factorA?.mean).toBeCloseTo(2.667, 3);
    expect(factorA?.computed).toBe('MediumHigh');
    // The same inputs under Round: Down give Medium — this is the branch that matters.
    expect(explainTree(fractionalMeanTree('Medium'), 'Medium', config([averagingFactor('Down')]))
      .byNodeId.get('0')?.computed).toBe('Medium');
  });

  it('leaves an exact integer mean alone when rounding up', () => {
    // `Truncate(mean - 0.0001) + 1` is not Ceiling, but it agrees with it on integers: a mean of
    // exactly 2 stays at 2 rather than being lifted to 3. The epsilon only bites within 0.0001
    // of an integer, which no mean over seven children can reach.
    const tree = [
      node('0', 'A', 'Medium', [
        node('0.0', '1', 'Medium', [node('0.0.0', 'Q1', 'Medium')]),
        node('0.1', '2', 'Medium', [node('0.1.0', 'Q2', 'Medium')]),
      ]),
    ];

    const explanation = explainTree(
      tree,
      'Medium',
      config([
        {
          Name: 'A',
          Operation: 'Avg',
          Round: 'Up',
          RevolvingDoorOrder: 1,
          Components: [
            { Name: '1', Operation: 'Max', Round: 0, QuestionAnswers: null, RiskLevelWeight: [] },
            { Name: '2', Operation: 'Max', Round: 0, QuestionAnswers: null, RiskLevelWeight: [] },
          ],
        },
      ]),
    );

    expect(explanation.byNodeId.get('0')?.mean).toBe(2);
    expect(explanation.byNodeId.get('0')?.computed).toBe('Medium');
  });

  it('treats the stray Round: 0 as unset rather than as Down', () => {
    // Round is Up = 1, Down = 2. The 0 on every non-averaging factor is default(Round), and the
    // engine's `round == Round.Down` test fails for it, so it takes the round-up branch. Reading
    // 0 as "down" would quietly move this factor a level.
    const explanation = explainTree(
      fractionalMeanTree('MediumHigh'),
      'MediumHigh',
      config([averagingFactor(0)]),
    );

    expect(explanation.byNodeId.get('0')?.rounding).toBeNull();
    expect(explanation.byNodeId.get('0')?.computed).toBe('MediumHigh');
  });
});
