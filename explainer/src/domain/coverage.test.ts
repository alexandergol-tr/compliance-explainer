import { describe, expect, it } from 'vitest';
import { buildCoverageIndex } from './coverage';
import { KycAnswerIds, KycQuestionIds } from './generated/kyc-enums';
import type { LoadedConfig } from '@/config/types';

const q = (name: keyof typeof KycQuestionIds) => KycQuestionIds[name];
const a = (name: keyof typeof KycAnswerIds) => KycAnswerIds[name];

function config(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    id: 'CySEC-24',
    regulation: 'CySEC',
    version: 24,
    updatedOn: null,
    scoresSuitability: true,
    defaultRiskLevel: 'Medium',
    rootOperation: 'Min',
    rootRounding: null,
    riskLevelWeight: [],
    scoreMappings: {},
    factors: [
      {
        Name: 'B',
        Operation: 'Avg',
        Round: 'Down',
        RevolvingDoorOrder: 1,
        Components: [
          {
            Name: '7',
            Operation: 'Max',
            RiskLevelWeight: null,
            QuestionAnswers: [
              {
                Question: 'IncomeSource',
                IsRequiredForCopy: true,
                Answers: [{ Answer: 'Salary', RiskLevel: 'High' }],
                WeigthAnswers: null,
              },
            ],
          },
          {
            Name: '8',
            Operation: 'Max',
            RiskLevelWeight: null,
            QuestionAnswers: [
              {
                Question: 'TradingKnowledgeAssessment',
                IsRequiredForCopy: false,
                Answers: null,
                // Deliberately the misspelled production field name, and deliberately the real
                // shape: a list of *groups*, each holding its own statements.
                WeigthAnswers: [
                  {
                    Answers: [
                      { Answer: 'NewerLeverage', Score: 2 },
                      { Answer: 'NewerCfd', Score: -2 },
                    ],
                    QuestionScoreToRiskLevelMappings: [{ RiskLevel: 'High', MinTotalScore: 4 }],
                    QuestionScoreToBlockResultMappings: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    blockChecks: [
      {
        Condition: 'All',
        Priority: 1,
        Result: 'Blocked',
        DefaultResult: 'NotBlocked',
        MinCount: 1,
        IsAlternative: false,
        NestedChecks: [],
        QuestionAnswerChecks: [{ Question: 'AnnualIncome', Answers: ['UpTo10K'] }],
      },
    ],
    blockDefaultResult: 'NotBlocked',
    negativeMarketProducts: [],
    ...overrides,
  };
}

describe('buildCoverageIndex', () => {
  const index = buildCoverageIndex(config());

  it('recognises a scored answer', () => {
    expect(index.classify(q('IncomeSource'), a('Salary'))).toEqual(['scored']);
  });

  it('flags the funnel/config gap: scored question, unlisted answer', () => {
    // The C-48 case. 28,850 users have picked this and no configuration scores it.
    expect(index.classify(q('IncomeSource'), a('InvestmentsDeposits'))).toEqual([
      'unscored-answer',
    ]);
  });

  it('reads statements out of the misspelled WeigthAnswers groups', () => {
    // Read as a flat list this returned `unscored-answer` for every statement, so anyone who took
    // the current knowledge assessment saw all six flagged as a config gap.
    expect(index.classify(q('TradingKnowledgeAssessment'), a('NewerLeverage'))).toEqual(['scored']);
    expect(index.classify(q('TradingKnowledgeAssessment'), a('NewerCfd'))).toEqual(['scored']);
  });

  it('matches an aliased id whichever of its names the configuration uses', () => {
    // Id 143 is `NewerCfd` in the configuration, but its first-declared enum name is an obsolete
    // one. Resolving the id back to a name picked the obsolete spelling and found no match, so
    // every Component 8 statement came out as a config gap on real profiles.
    expect(a('NewerCfd')).toBe(
      a('IfThePriceOfGoogleStockOnNasdaqGoesUpThePriceOfYourCfdInGoogleWillGoDownNew'),
    );
    expect(index.classify(q('TradingKnowledgeAssessment'), 143)).toEqual(['scored']);
  });

  it('still flags a statement the weighted group does not list', () => {
    expect(index.classify(q('TradingKnowledgeAssessment'), a('NewerMarginCall'))).toEqual([
      'unscored-answer',
    ]);
  });

  it('does not mistake a hard-block input for a config gap', () => {
    // The false positive this module was written to remove: AnnualIncome legitimately has no
    // risk-level scoring, so calling it "not scored" implies a defect that is not there.
    expect(index.classify(q('AnnualIncome'), a('UpTo10K'))).toContain('block-input');
    expect(index.classify(q('AnnualIncome'), a('Between10KAnd50K'))).toContain('block-input');
  });

  it('reports both jobs when an answer has two', () => {
    // Income drives the hard block and financial sustainability. A single verdict had to drop one,
    // and dropping the second is what left the monitoring gate looking like it had no inputs.
    expect(index.classify(q('AnnualIncome'), a('UpTo10K'))).toEqual([
      'block-input',
      'monitoring-input',
    ]);
  });

  it('recognises a monitoring input that no configuration mentions', () => {
    // The deposit question is nowhere in the document, so a document-only view filed it under
    // "not used by suitability" while it was setting the copy ceiling.
    expect(index.classify(q('InvestmentPlan'), a('AnswerBetween20KAnd50K'))).toEqual([
      'monitoring-input',
    ]);
  });

  it('separates "not used at all" from all of the above', () => {
    expect(index.classify(q('IsraeliCitizenship'), a('Checked'))).toEqual(['not-used']);
  });

  it('says nothing when there is no configuration', () => {
    expect(buildCoverageIndex(null).classify(q('IncomeSource'), a('Salary'))).toEqual(['unknown']);
  });

  it('walks nested block checks', () => {
    const nested = buildCoverageIndex(
      config({
        blockChecks: [
          {
            Condition: 'All',
            Priority: 1,
            Result: 'Blocked',
            DefaultResult: 'NotBlocked',
            MinCount: 1,
            IsAlternative: false,
            QuestionAnswerChecks: [],
            NestedChecks: [
              {
                Condition: 'All',
                Priority: 1,
                Result: 'Blocked',
                DefaultResult: 'NotBlocked',
                MinCount: 1,
                IsAlternative: false,
                NestedChecks: [],
                QuestionAnswerChecks: [{ Question: 'LiquidAssets', Answers: ['UpTo10K'] }],
              },
            ],
          },
        ],
      }),
    );
    expect(nested.classify(q('LiquidAssets'), a('UpTo10K'))).toContain('block-input');
  });
});
