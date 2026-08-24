import { describe, expect, it } from 'vitest';
import { COUNTRY_ETORO, deriveOutcome, verdictFor } from './outcome';
import type { RawProfile } from '@/sources/types';

const LEVEL = { Low: 200, Medium: 300, High: 500 } as const;
const BLOCK = { Blocked: 1, NotBlocked: 2 } as const;

function profile(overrides: Partial<RawProfile> = {}): RawProfile {
  return {
    gcid: 1,
    regulation: 'CySEC',
    countryId: 56,
    verificationLevel: 2,
    configurationVersion: 24,
    suitability: {
      clientRiskLevel: LEVEL.Medium,
      suitabilityBlock: BLOCK.NotBlocked,
      isAllQuestionsAnswered: true,
      ongoingMonitoring: { financialSustainability: 100, copyUtilization: 50 },
      suitabilityCalculationDetails: [],
    },
    ...overrides,
  };
}

describe('deriveOutcome — the states that are easy to conflate', () => {
  it('treats below-verification-level-2 as absent, not Minimal', () => {
    const outcome = deriveOutcome(profile({ verificationLevel: 1, suitability: null }));
    expect(outcome.kind).toBe('not-assessed');
    // The bug this guards: rendering an unassessed user as the lowest band.
    expect(JSON.stringify(outcome)).not.toContain('Minimal');
  });

  it('treats a missing profile as never-calculated, distinct from not-assessed', () => {
    expect(deriveOutcome(null).kind).toBe('never-calculated');
  });

  it('flags an internal eToro account before reading its hardcoded result', () => {
    // High + not blocked looks like a real assessment; it is a placeholder.
    const outcome = deriveOutcome(
      profile({
        countryId: COUNTRY_ETORO,
        suitability: {
          clientRiskLevel: LEVEL.High,
          suitabilityBlock: BLOCK.NotBlocked,
          isAllQuestionsAnswered: true,
          ongoingMonitoring: { manuallyUnblocked: true },
          suitabilityCalculationDetails: [],
        },
      }),
    );
    expect(outcome.kind).toBe('internal-account');
  });

  it('explains a non-scoring regulation rather than reporting missing data', () => {
    const outcome = deriveOutcome(
      profile({
        regulation: 'MAS',
        configurationVersion: 12,
        suitability: { clientRiskLevel: null, suitabilityBlock: null },
      }),
    );
    expect(outcome).toMatchObject({ kind: 'regulation-does-not-score', regulation: 'MAS' });
  });
});

describe('deriveOutcome — authorised risk score', () => {
  it('prefers the score mapping from the config over the fallback', () => {
    const outcome = deriveOutcome(profile(), { Medium: 7 });
    expect(outcome).toMatchObject({ kind: 'assessed', authorizedRiskScore: 7, scoreFromConfig: true });
  });

  it('marks the fallback when no config mapping is available', () => {
    const outcome = deriveOutcome(profile(), null);
    expect(outcome).toMatchObject({ kind: 'assessed', authorizedRiskScore: 6, scoreFromConfig: false });
  });

  it('collapses Minimal and Low to the same cap of 3', () => {
    const low = deriveOutcome(profile({ suitability: { clientRiskLevel: LEVEL.Low } }), null);
    const minimal = deriveOutcome(profile({ suitability: { clientRiskLevel: 100 } }), null);
    expect(low).toMatchObject({ authorizedRiskScore: 3 });
    expect(minimal).toMatchObject({ authorizedRiskScore: 3 });
  });
});

describe('ongoing monitoring is tri-state', () => {
  it('blocks when utilisation exceeds sustainability', () => {
    const outcome = deriveOutcome(
      profile({
        suitability: {
          clientRiskLevel: LEVEL.Medium,
          ongoingMonitoring: { financialSustainability: 100, copyUtilization: 101 },
        },
      }),
    );
    expect(outcome).toMatchObject({ monitoring: { kind: 'blocked' } });
  });

  it('reports not-evaluated when an input is missing, rather than passing', () => {
    const outcome = deriveOutcome(
      profile({
        suitability: {
          clientRiskLevel: LEVEL.Medium,
          ongoingMonitoring: { financialSustainability: null, copyUtilization: 50 },
        },
      }),
    );
    expect(outcome).toMatchObject({ monitoring: { kind: 'not-evaluated' } });
  });

  it('lets a manual unblock win over the comparison', () => {
    const outcome = deriveOutcome(
      profile({
        suitability: {
          clientRiskLevel: LEVEL.Medium,
          ongoingMonitoring: {
            financialSustainability: 10,
            copyUtilization: 9_999,
            manuallyUnblocked: true,
          },
        },
      }),
    );
    expect(outcome).toMatchObject({ monitoring: { kind: 'manually-unblocked' } });
  });
});

describe('verdictFor', () => {
  it('allows a target at exactly the cap', () => {
    const outcome = deriveOutcome(profile(), null);
    expect(verdictFor(outcome, 6).allowed).toBe(true);
  });

  it('refuses a target one above the cap', () => {
    const outcome = deriveOutcome(profile(), null);
    expect(verdictFor(outcome, 7).allowed).toBe(false);
  });

  it('refuses everything when hard blocked, cap notwithstanding', () => {
    const outcome = deriveOutcome(
      profile({
        suitability: { clientRiskLevel: LEVEL.High, suitabilityBlock: BLOCK.Blocked },
      }),
      null,
    );
    expect(verdictFor(outcome, 1).allowed).toBe(false);
  });

  it('refuses when there is no assessment at all', () => {
    expect(verdictFor(deriveOutcome(null), 1).allowed).toBe(false);
  });
});
