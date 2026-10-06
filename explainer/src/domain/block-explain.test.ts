import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/config/load';
import type { BlockCheck } from '@/config/types';
import { KycAnswerIds, KycQuestionIds } from './generated/kyc-enums';
import {
  answersByQuestion,
  buildCheckNode,
  decisiveLeaves,
  explainHardBlock,
  matchedLeaves,
} from './block-explain';

function knockout(condition: 'Any' | 'All', ...questions: string[]): BlockCheck {
  return {
    Condition: condition,
    Priority: 1,
    Result: 'Blocked',
    DefaultResult: 'Blocked',
    MinCount: 1,
    IsAlternative: false,
    NestedChecks: [],
    QuestionAnswerChecks: questions.map((Question) => ({
      Question,
      Condition: 'Any',
      Answers: ['UpTo10K'],
      ExcludeAnswers: [],
    })),
  };
}

function incomeSourceCheck(condition: 'Any' | 'All'): BlockCheck {
  return {
    Condition: 'All',
    Priority: 1,
    Result: 'Blocked',
    DefaultResult: 'Blocked',
    MinCount: 1,
    IsAlternative: false,
    NestedChecks: [],
    QuestionAnswerChecks: [
      {
        Question: 'IncomeSource',
        Condition: condition,
        Answers: ['Pension', 'Salary'],
        ExcludeAnswers: [],
      },
    ],
  };
}

describe('explainHardBlock', () => {
  it('marks CySEC knockout answers as matched and leaves a passing set unmatched', async () => {
    const config = await loadConfig('CySEC-24');
    expect(config).not.toBeNull();

    const blocked = explainHardBlock(config, [
      { questionId: KycQuestionIds.RiskAppetite, answerIds: [KycAnswerIds.Plus5ToMinus3Percent] },
      { questionId: KycQuestionIds.TradingPurpose, answerIds: [KycAnswerIds.FuturePlanning] },
      { questionId: KycQuestionIds.AnnualIncome, answerIds: [KycAnswerIds.UpTo10K] },
      { questionId: KycQuestionIds.LiquidAssets, answerIds: [KycAnswerIds.UpTo10K] },
    ]);

    expect(matchedLeaves(blocked).map((l) => l.question).sort()).toEqual([
      'AnnualIncome',
      'LiquidAssets',
      'RiskAppetite',
      'TradingPurpose',
    ]);

    const passing = explainHardBlock(config, [
      { questionId: KycQuestionIds.RiskAppetite, answerIds: [KycAnswerIds.Plus20ToMinus12Percent] },
      { questionId: KycQuestionIds.TradingPurpose, answerIds: [KycAnswerIds.AdditionalRevenues] },
      { questionId: KycQuestionIds.AnnualIncome, answerIds: [KycAnswerIds.Between200KAnd1M] },
      { questionId: KycQuestionIds.LiquidAssets, answerIds: [KycAnswerIds.Between200KAnd1M] },
    ]);
    expect(matchedLeaves(passing)).toHaveLength(0);
  });

  it('treats a leaf Condition of All as needing every listed answer', () => {
    // FCA CFD KnockOut has IncomeSource with Condition "All" over [Pension, Salary]. A single
    // Salary answer must not read as a match — that was the reported "Triggers block" bug.
    const answers = answersByQuestion([
      { questionId: KycQuestionIds.IncomeSource, answerIds: [KycAnswerIds.Salary] },
    ]);
    const onlySalary = buildCheckNode(incomeSourceCheck('All'), answers);
    expect(matchedLeaves([onlySalary])).toHaveLength(0);

    const both = answersByQuestion([
      {
        questionId: KycQuestionIds.IncomeSource,
        answerIds: [KycAnswerIds.Salary, KycAnswerIds.Pension],
      },
    ]);
    expect(matchedLeaves([buildCheckNode(incomeSourceCheck('All'), both)])).toHaveLength(1);
  });

  it('treats a leaf Condition of Any as needing one listed answer', () => {
    const answers = answersByQuestion([
      { questionId: KycQuestionIds.IncomeSource, answerIds: [KycAnswerIds.Salary] },
    ]);
    expect(matchedLeaves([buildCheckNode(incomeSourceCheck('Any'), answers)])).toHaveLength(1);
  });

  it('excludes a listed answer via ExcludeAnswers', () => {
    const check: BlockCheck = {
      Condition: 'Any',
      Priority: 1,
      Result: 'Blocked',
      DefaultResult: 'Blocked',
      MinCount: 1,
      IsAlternative: false,
      NestedChecks: [],
      QuestionAnswerChecks: [
        {
          Question: 'IncomeSource',
          Condition: 'Any',
          Answers: ['Pension'],
          ExcludeAnswers: ['Salary'],
        },
      ],
    };
    const answers = answersByQuestion([
      { questionId: KycQuestionIds.IncomeSource, answerIds: [KycAnswerIds.Salary] },
    ]);
    expect(matchedLeaves([buildCheckNode(check, answers)])).toHaveLength(0);
  });

  it('includes ASIC GAML\'s extra IncomeSource condition', async () => {
    const config = await loadConfig('ASICGAML-15');
    const checks = explainHardBlock(config, [
      { questionId: KycQuestionIds.IncomeSource, answerIds: [KycAnswerIds.Pension] },
    ]);
    expect(matchedLeaves(checks).map((l) => l.question)).toEqual(['IncomeSource']);
  });

  it('carries DefaultResult and IsRequired so a fail-closed All group can be labelled honestly', () => {
    // Mirrors FCA CFD TradingExperience: an All group with DefaultResult Blocked over three
    // required inexperience questions. The screenshot case answered only TradingKnowledge.
    const inexperience: BlockCheck = {
      Condition: 'All',
      Priority: 0,
      Result: 'Blocked',
      DefaultResult: 'Blocked',
      MinCount: 1,
      IsAlternative: false,
      NestedChecks: [],
      QuestionAnswerChecks: [
        { Question: 'Crypto', Condition: 'Any', Answers: ['NeverTraded'], ExcludeAnswers: [], IsRequired: true },
        { Question: 'LeveragedCfd', Condition: 'Any', Answers: ['NeverTraded'], ExcludeAnswers: [], IsRequired: true },
        { Question: 'TradingKnowledge', Condition: 'Any', Answers: ['NoFinancialKnowledge'], ExcludeAnswers: [], IsRequired: true },
      ],
    };
    const answers = answersByQuestion([
      { questionId: KycQuestionIds.TradingKnowledge, answerIds: [KycAnswerIds.NoFinancialKnowledge] },
    ]);
    const group = buildCheckNode(inexperience, answers);

    expect(group.defaultResult).toBe('Blocked');
    if (group.kind !== 'group') throw new Error('expected group');

    // Only the answered knowledge question matches; the two unanswered required questions do not.
    expect(matchedLeaves([group]).map((l) => l.question)).toEqual(['TradingKnowledge']);

    const leaves = group.children.filter((c) => c.kind === 'leaf');
    expect(leaves.every((l) => l.kind === 'leaf' && l.isRequired)).toBe(true);
    const crypto = leaves.find((l) => l.kind === 'leaf' && l.question === 'Crypto');
    expect(crypto && crypto.kind === 'leaf' && crypto.answered).toBe(false);
  });
});

describe('decisiveLeaves', () => {
  // FCA CFD KnockOut lists net annual income in an `Any` check and again inside two `All` checks
  // whose other members do not match. matchedLeaves reported it three times plus liquid assets
  // twice; the summary must show only what actually trips the block, once.
  const anyIncome = knockout('Any', 'AnnualIncome');
  const allIncomeAndAssets = knockout('All', 'AnnualIncome', 'LiquidAssets');

  it('drops a matched leaf whose sibling in an All check does not match', () => {
    const answers = answersByQuestion([
      { questionId: KycQuestionIds.AnnualIncome, answerIds: [KycAnswerIds.UpTo10K] },
      // LiquidAssets unanswered → the All check cannot complete.
    ]);
    const nodes = [buildCheckNode(anyIncome, answers), buildCheckNode(allIncomeAndAssets, answers)];

    // matchedLeaves over-reports: income twice (Any + All).
    expect(matchedLeaves(nodes).map((l) => l.question)).toEqual(['AnnualIncome', 'AnnualIncome']);
    // decisiveLeaves keeps only the Any-check hit, deduped to one.
    expect(decisiveLeaves(nodes).map((l) => l.question)).toEqual(['AnnualIncome']);
  });

  it('keeps every member of an All check that fully completes, deduped by question', () => {
    const answers = answersByQuestion([
      { questionId: KycQuestionIds.AnnualIncome, answerIds: [KycAnswerIds.UpTo10K] },
      { questionId: KycQuestionIds.LiquidAssets, answerIds: [KycAnswerIds.UpTo10K] },
    ]);
    const nodes = [buildCheckNode(anyIncome, answers), buildCheckNode(allIncomeAndAssets, answers)];

    expect(decisiveLeaves(nodes).map((l) => l.question).sort()).toEqual([
      'AnnualIncome',
      'LiquidAssets',
    ]);
  });
});
