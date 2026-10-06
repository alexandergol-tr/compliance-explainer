import { describe, expect, it } from 'vitest';
import { deriveFormula } from './formula';
import { loadConfig, loadScoringConfigs } from '@/config/load';

/**
 * Run against the real documents in `config-prod/` rather than hand-built fixtures. The point of
 * this module is to restate a document faithfully, and a fixture would only prove it restates the
 * fixture. It also means a config refresh that changes the rules fails here rather than silently
 * rendering the old shape.
 */

async function formulaFor(id: string) {
  const config = await loadConfig(id);
  expect(config, `${id} is missing from config-prod/`).not.toBeNull();
  const formula = deriveFormula(config!);
  expect(formula, `${id} should score suitability`).not.toBeNull();
  return formula!;
}

describe('deriveFormula', () => {
  it('states the root as the weaker of the two factors', async () => {
    const formula = await formulaFor('CySEC-24');
    expect(formula.lines[0].expression).toBe('Min(Factor A, Factor B)');
  });

  it('keeps factors in document order so the section reads like the tree', async () => {
    const formula = await formulaFor('CySEC-24');
    const factors = formula.lines.filter((line) => line.level === 'factor').map((l) => l.symbol);
    expect(factors).toEqual(['Factor A', 'Factor B']);
  });

  it('marks rounding only where averaging makes it matter', async () => {
    const formula = await formulaFor('CySEC-24');
    const factorA = formula.lines.find((line) => line.symbol === 'Factor A');
    const factorB = formula.lines.find((line) => line.symbol === 'Factor B');
    // Factor A is a Min carrying `Round: 0`, which is `default(Round)` and not a direction.
    expect(factorA?.qualifiers).toEqual([]);
    expect(factorB?.qualifiers).toContain('rounded down');
  });

  it('surfaces Component 9 as the only component on its own scale', async () => {
    const formula = await formulaFor('CySEC-24');
    expect(formula.componentScales.map((s) => s.symbol)).toEqual(['C9']);
    expect(formula.componentScales[0].weights).toEqual([
      { level: 'High', weight: 500 },
      { level: 'MediumHigh', weight: 400 },
      { level: 'Medium', weight: 300 },
      { level: 'Low', weight: 200 },
      { level: 'Minimal', weight: 100 },
    ]);
  });

  it('drops the prefix shared by all of a component\u2019s questions', async () => {
    const formula = await formulaFor('CySEC-24');
    const c9 = formula.lines.find((line) => line.symbol === 'C9');
    expect(c9?.expression).toBe(
      'Avg(High volatility, Cyber risks, Recover loss, Investing risks, Private key)',
    );
  });

  it('leaves an accidental prefix overlap alone', async () => {
    // `Equities` is a prefix of `EquitiesInvestedAmount`, but they are in different components and
    // the overlap within C2 is not a shared prefix across all three, so nothing is trimmed.
    const formula = await formulaFor('CySEC-24');
    const c2 = formula.lines.find((line) => line.symbol === 'C2');
    expect(c2?.expression).toBe(
      'Max(Equities invested amount, Crypto invested amount, Leveraged CFD invested amount)',
    );
  });

  it('names hard-block answers the way the customer saw them', async () => {
    const formula = await formulaFor('CySEC-24');
    const risk = formula.blocks[0].conditions.find((c) => c.question.includes('comfortable'));
    expect(risk?.answers).toEqual(['Very conservative']);
  });

  it('flags FCA\u2019s fallback as one the engine never reads', async () => {
    // The config says `Blocked`, which reads as fail-closed. It is not: the engine returns the
    // block-level fallback on fall-through, and that is NotBlocked. See verification.md C-50.
    const fca = await formulaFor('FCA-15');
    expect(fca.blocks[0].unreachableFallback).toBe('Blocked');
    expect(fca.blockFallback).toBe('NotBlocked');

    const cysec = await formulaFor('CySEC-24');
    expect(cysec.blocks[0].unreachableFallback).toBeNull();
  });

  it('shows ASIC GAML\u2019s stricter block without special-casing it', async () => {
    const gaml = await formulaFor('ASICGAML-15');
    const questions = gaml.blocks[0].conditions.map((c) => c.question);
    // Five conditions rather than four, and pension as a funding source is the extra one.
    expect(questions).toHaveLength(5);
    expect(questions.some((q) => q.includes('fund your account'))).toBe(true);

    // It also blocks on two risk-appetite bands where CySEC blocks on one.
    const risk = gaml.blocks[0].conditions.find((c) => c.question.includes('comfortable'));
    expect(risk?.answers).toHaveLength(2);
  });

  it('reports no Component 9 outside CySEC', async () => {
    for (const id of ['FCA-15', 'ASIC-9', 'ASICGAML-15', 'FSRA-10']) {
      const formula = await formulaFor(id);
      expect(formula.lines.some((line) => line.symbol === 'C9'), id).toBe(false);
      expect(formula.componentScales, id).toEqual([]);
    }
  });

  it('produces a formula for every scoring config on disk', async () => {
    const configs = await loadScoringConfigs();
    expect(configs.length).toBeGreaterThan(0);
    for (const config of configs) {
      const formula = deriveFormula(config);
      expect(formula, config.id).not.toBeNull();
      // Every symbol a parent references must be defined by a line of its own, or the formula
      // renders a dangling reference.
      const defined = new Set(formula!.lines.map((line) => line.symbol));
      for (const line of formula!.lines) {
        const referenced = line.expression.match(/\((.*)\)/)?.[1].split(', ') ?? [];
        for (const symbol of referenced) {
          if (/^(Factor \w+|C\d+)$/.test(symbol)) {
            expect(defined.has(symbol), `${config.id}: ${line.symbol} references ${symbol}`).toBe(true);
          }
        }
      }
    }
  });

  it('returns nothing for a regulation that stopped scoring', async () => {
    const mas = await loadConfig('MAS-12');
    expect(mas).not.toBeNull();
    expect(deriveFormula(mas!)).toBeNull();
  });

  it('CySEC-26 scores Q8 903 as High and lifts Investments off Low', async () => {
    const config = await loadConfig('CySEC-26');
    expect(config, 'CySEC-26 is missing from config-prod/').not.toBeNull();
    const answers =
      config!.factors
        .find((f) => f.Name === 'A')
        ?.Components?.find((c) => c.Name === '5')
        ?.QuestionAnswers?.find((q) => q.Question === 'TradingPurpose')?.Answers ?? [];
    const byName = Object.fromEntries(answers.map((a) => [a.Answer, a.RiskLevel]));
    expect(byName.PurposeCryptoTradingAndOrConversion).toBe('High');
    expect(byName.PurposeInvestments).toBe('Medium');
  });
});
