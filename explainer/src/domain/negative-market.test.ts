import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/config/load';
import { deriveNmOutcome, matchedLeaves, type NmCheckLeaf } from '@/domain/negative-market';
import type { RawProfile } from '@/sources/types';

function profile(overrides: Partial<RawProfile> = {}): RawProfile {
  return {
    gcid: 1001,
    regulation: 'CySEC',
    configurationVersion: 24,
    verificationLevel: 2,
    ...overrides,
  };
}

describe('deriveNmOutcome', () => {
  it('reports never-calculated when there is no profile', async () => {
    const outcome = deriveNmOutcome(null, null);
    expect(outcome.kind).toBe('never-calculated');
  });

  it('lists CySEC products from config with stored results', async () => {
    const config = await loadConfig('CySEC-24');
    expect(config).not.toBeNull();

    const outcome = deriveNmOutcome(
      profile({
        productNegativeMarkets: {
          Cfd: { result: 'NotBlocked', ruleResults: [{ rule: 'KnockOut', result: 'NotBlocked' }] },
          Futures: { result: 'NotBlocked' },
        },
      }),
      config,
    );

    expect(outcome.kind).toBe('assessed');
    if (outcome.kind !== 'assessed') return;

    expect(outcome.products.map((p) => p.storedKey)).toEqual([
      'Cfd',
      'Futures',
      'Margin',
      'ExperimentalCrypto',
    ]);
    expect(outcome.products[0]?.result).toBe('NotBlocked');
    expect(outcome.products[0]?.rules[0]?.name).toBe('KnockOut');
  });

  it('does not treat a missing stored key as NotBlocked', async () => {
    const config = await loadConfig('CySEC-24');
    const outcome = deriveNmOutcome(profile({ productNegativeMarkets: {} }), config);
    expect(outcome.kind).toBe('assessed');
    if (outcome.kind !== 'assessed') return;
    expect(outcome.products.every((p) => p.result === 'Unknown')).toBe(true);
  });

  it('matches camelCase stored keys from the Cosmos read path', async () => {
    const config = await loadConfig('ASICGAML-15');
    const outcome = deriveNmOutcome(
      profile({
        regulation: 'ASICGAML',
        configurationVersion: 15,
        productNegativeMarkets: {
          // After toCamel, PascalCase product keys arrive lower-first.
          cfd: {
            result: 'Blocked',
            ruleResults: [{ rule: 'KnockOut', result: 'Blocked' }],
          },
          experimentalCrypto: { result: 'NotBlocked' },
        },
      }),
      config,
    );

    expect(outcome.kind).toBe('assessed');
    if (outcome.kind !== 'assessed') return;
    expect(outcome.products.map((p) => p.storedKey)).toEqual(['Cfd', 'ExperimentalCrypto']);
    expect(outcome.products[0]?.result).toBe('Blocked');
    expect(outcome.products[0]?.blockingRule).toBe('KnockOut');
    expect(outcome.products[1]?.result).toBe('NotBlocked');
  });

  it('annotates the KnockOut predicate with the user answers that trip it', async () => {
    const config = await loadConfig('CySEC-24');

    const outcome = deriveNmOutcome(
      profile({
        productNegativeMarkets: {
          Cfd: { result: 'Blocked', ruleResults: [{ rule: 'KnockOut', result: 'Blocked' }] },
        },
        questionsAnswers: [
          { questionId: 9, answerIds: [23] }, // RiskAppetite = Plus5ToMinus3Percent
          { questionId: 10, answerIds: [34] }, // AnnualIncome = UpTo10K
        ],
      }),
      config,
    );

    expect(outcome.kind).toBe('assessed');
    if (outcome.kind !== 'assessed') return;

    const cfd = outcome.products.find((p) => p.storedKey === 'Cfd');
    const knockOut = cfd?.rules.find((r) => r.name === 'KnockOut');
    expect(knockOut?.checks.length).toBeGreaterThan(0);

    const hits = matchedLeaves(knockOut?.checks ?? []);
    expect(hits.map((l) => l.question).sort()).toEqual(['AnnualIncome', 'RiskAppetite']);

    const riskAppetite = hits.find((l) => l.question === 'RiskAppetite') as NmCheckLeaf;
    expect(riskAppetite.matched).toBe(true);
    expect(riskAppetite.blocksOn.map((a) => a.name)).toContain('Plus5ToMinus3Percent');
    expect(riskAppetite.userAnswers.map((a) => a.id)).toEqual([23]);
  });

  it('does not flag a knockout when the user gave a passing answer', async () => {
    const config = await loadConfig('CySEC-24');

    const outcome = deriveNmOutcome(
      profile({
        productNegativeMarkets: {
          Cfd: { result: 'NotBlocked', ruleResults: [{ rule: 'KnockOut', result: 'NotBlocked' }] },
        },
        questionsAnswers: [
          { questionId: 9, answerIds: [24] }, // RiskAppetite = something other than the knockout
          { questionId: 10, answerIds: [36] }, // AnnualIncome = a higher band
        ],
      }),
      config,
    );

    if (outcome.kind !== 'assessed') throw new Error('expected assessed');
    const knockOut = outcome.products
      .find((p) => p.storedKey === 'Cfd')
      ?.rules.find((r) => r.name === 'KnockOut');

    expect(knockOut?.checks.length).toBeGreaterThan(0);
    expect(matchedLeaves(knockOut?.checks ?? [])).toHaveLength(0);
  });

  it('includes stored-only products not on the config (e.g. MAS Etf)', async () => {
    const config = await loadConfig('MAS-12');
    const outcome = deriveNmOutcome(
      profile({
        regulation: 'MAS',
        configurationVersion: 12,
        productNegativeMarkets: {
          Cfd: { result: 'NotBlocked', ruleResults: [{ rule: 'KnockOut', result: 'NotBlocked' }] },
          Etf: { result: 'Blocked', ruleResults: [{ rule: 'KnockOut', result: 'Blocked' }] },
        },
      }),
      config,
    );

    expect(outcome.kind).toBe('assessed');
    if (outcome.kind !== 'assessed') return;
    expect(outcome.products.some((p) => p.storedKey === 'Etf')).toBe(true);
  });
});
