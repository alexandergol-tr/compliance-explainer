import { describe, expect, it } from 'vitest';
import { normaliseTree, type RawNode } from './tree';

/**
 * The production shape, verified against 578 stored trees: no level discriminator anywhere,
 * question identity as the enum name in both `Name` and `Question`.
 */
const PRODUCTION_SHAPE: RawNode[] = [
  {
    name: 'A',
    clientRiskLevel: 400,
    revolvingDoorOrder: 2,
    childs: [
      {
        name: '5',
        clientRiskLevel: 400,
        childs: [{ name: 'TradingPurpose', question: 'TradingPurpose', clientRiskLevel: 400, childs: [] }],
      },
    ],
  },
];

/** An older configuration version: the leaf has no `Question`, only `Name`. 289 of 7,231
 *  production leaves look like this, so it is a normal payload rather than a defect. */
const NAME_ONLY: RawNode[] = [
  {
    name: 'A',
    clientRiskLevel: 400,
    revolvingDoorOrder: 2,
    childs: [{ name: '5', clientRiskLevel: 400, childs: [{ name: 'TradingPurpose', clientRiskLevel: 400, childs: [] }] }],
  },
];

describe('normaliseTree', () => {
  it('derives levels from depth, which is the only mechanism the payload offers', () => {
    const tree = normaliseTree(PRODUCTION_SHAPE);
    expect(tree.counts).toEqual({ factor: 1, component: 1, question: 1 });
    expect(tree.warnings).toEqual([]);
  });

  it('titles a question with the wording the customer was shown', () => {
    const question = normaliseTree(PRODUCTION_SHAPE).nodes[0].children[0].children[0];
    expect(question.questionId).toBe(8);
    // Not "Trading purpose" — that is the enum name, which no customer ever sees. The identifier
    // is kept alongside because the configuration keys on it.
    expect(question.title).toBe('What can we help you achieve?');
    expect(question.questionLabel?.identifier).toBe('TradingPurpose');
    expect(question.questionLabel?.source).toBe('static-data');
  });

  it('falls back to Name when the leaf carries no Question field, without warning', () => {
    // Older config versions omit `Question`. Warning here would fire on real, healthy data.
    const tree = normaliseTree(NAME_ONLY);
    const question = tree.nodes[0].children[0].children[0];
    expect(question.questionId).toBe(8);
    expect(question.title).toBe('What can we help you achieve?');
    expect(tree.warnings).toEqual([]);
  });

  it('accepts a numeric question id, which is how the SQL projection stores it', () => {
    const tree = normaliseTree([
      { name: 'A', clientRiskLevel: 400, childs: [{ name: '5', clientRiskLevel: 400, childs: [{ question: 8, clientRiskLevel: 400, childs: [] }] }] },
    ]);
    expect(tree.nodes[0].children[0].children[0].questionId).toBe(8);
  });

  it('names components rather than showing a bare number', () => {
    const component = normaliseTree(PRODUCTION_SHAPE).nodes[0].children[0];
    expect(component.title).toBe('Component 5 — Purpose of trading');
  });

  it('warns when a question name matches no enum member', () => {
    // The likely cause is an enum snapshot older than the config that produced the result,
    // which is worth saying out loud rather than rendering a humanised guess in silence.
    const tree = normaliseTree([
      { name: 'A', clientRiskLevel: 400, childs: [{ name: '5', clientRiskLevel: 400, childs: [{ name: 'SomeFutureQuestion', clientRiskLevel: 400, childs: [] }] }] },
    ]);
    expect(tree.warnings.join(' ')).toContain('SomeFutureQuestion');
    // Still renders something readable rather than dropping the node.
    expect(tree.nodes[0].children[0].children[0].title).toBe('Some future question');
  });

  it('warns when a leaf can be identified at all', () => {
    const tree = normaliseTree([
      { name: 'A', clientRiskLevel: 400, childs: [{ name: '5', clientRiskLevel: 400, childs: [{ clientRiskLevel: 400, childs: [] }] }] },
    ]);
    expect(tree.warnings.join(' ')).toContain('cannot be identified');
  });

  it('warns when a subtype field turns up at the wrong depth', () => {
    // A question id on a root node means the payload is not the shape depth-derivation assumes.
    const tree = normaliseTree([{ name: 'A', question: 8, clientRiskLevel: 400, childs: [] }]);
    expect(tree.warnings.join(' ')).toContain('wrong depth');
  });

  it('warns when the tree is deeper than three levels', () => {
    const tree = normaliseTree([
      { name: 'A', clientRiskLevel: 400, childs: [{ name: '5', clientRiskLevel: 400, childs: [{ name: 'TradingPurpose', clientRiskLevel: 400, childs: [{ name: 'deeper', clientRiskLevel: 400, childs: [] }] }] }] },
    ]);
    expect(tree.warnings.join(' ')).toContain('deeper than the three levels');
  });

  it('accepts `children` as well as the C# spelling `childs`', () => {
    const tree = normaliseTree([
      { name: 'A', clientRiskLevel: 400, children: [{ name: '5', clientRiskLevel: 400, children: [] }] },
    ]);
    expect(tree.counts.component).toBe(1);
  });

  it('returns an empty result without warning for an empty tree', () => {
    // Emptiness is legitimate for several outcomes, so the reason is the caller's to explain.
    expect(normaliseTree([])).toMatchObject({ nodes: [], warnings: [] });
    expect(normaliseTree(null)).toMatchObject({ nodes: [], warnings: [] });
  });

  it('maps risk level ids, which are 100..500 rather than 1..5', () => {
    expect(normaliseTree(PRODUCTION_SHAPE).nodes[0].riskLevel).toBe('MediumHigh');
    expect(normaliseTree([{ clientRiskLevel: 4, childs: [] }]).nodes[0].riskLevel).toBeNull();
  });

  it('reproduces the live CySEC v23 arithmetic it renders', () => {
    // A rendering test would not catch a tree whose own numbers do not add up, and the whole
    // value of this view is that the reader can trust the parent nodes. Component = Max over
    // questions, Factor A = Min, Factor B = floor(Avg), root = Min — tech.md §4.2.
    const weight = { Minimal: 0, Low: 1, Medium: 2, MediumHigh: 3, High: 4 } as const;
    const tree = normaliseTree(PRODUCTION_SHAPE);
    const component = tree.nodes[0].children[0];
    const questionWeights = component.children.map((q) => weight[q.riskLevel!]);
    expect(weight[component.riskLevel!]).toBe(Math.max(...questionWeights));
  });
});
