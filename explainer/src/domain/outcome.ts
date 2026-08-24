/**
 * The headline outcome, as a discriminated union.
 *
 * This shape exists to make one class of bug unrepresentable. "No risk level" and
 * "risk level Minimal" are different facts with different consequences, and an app that
 * renders the first as the second tells a compliance reader that a user was assessed and
 * placed at the bottom when in truth they were never assessed at all. A nullable
 * `riskLevel` field invites exactly that collapse; separate variants forbid it.
 *
 * Four ways a user can have no score, all of them normal:
 *   - below verification level 2         -> the calculator returns before scoring
 *   - internal eToro account             -> hardcoded result, formulas skipped
 *   - regulation does not run the test   -> e.g. MAS from v3 onward
 *   - never calculated                   -> no stored profile at all
 */

import {
  FALLBACK_AUTHORIZED_RISK_SCORE,
  isBlocked,
  recalculationReasonName,
  regulationName,
  riskLevelName,
  SCORING_REGULATIONS,
  type RiskLevelName,
} from './ids';
import type { RawProfile } from '@/sources/types';

/** `Country.eToro` — KYCAnalyzer/eToro.KYCAnalyzerService.Domain/Enums/Country.cs */
export const COUNTRY_ETORO = 250;

/** Below this, `SuitabilityCalculator.CalculateAsync` returns before scoring. */
export const MIN_VERIFICATION_LEVEL = 2;

export interface Provenance {
  regulation: string | null;
  configurationVersion: number | null;
  countryId: number | null;
  verificationLevel: number | null;
  recalculationReason: string | null;
  updatedOn: string | null;
  lastAnswerOccurredAt: string | null;
}

/** Tri-state: the solvency gate can be un-evaluated, which is not the same as passing. */
export type MonitoringState =
  | { kind: 'blocked'; financialSustainability: number; copyUtilization: number }
  | { kind: 'within-limit'; financialSustainability: number; copyUtilization: number }
  | { kind: 'manually-unblocked' }
  | { kind: 'not-evaluated'; reason: string };

export type Outcome =
  | {
      kind: 'assessed';
      riskLevel: RiskLevelName;
      authorizedRiskScore: number;
      /** True when the config supplied the score, false when it came from the fallback map. */
      scoreFromConfig: boolean;
      hardBlocked: boolean | null;
      monitoring: MonitoringState;
      isAllQuestionsAnswered: boolean | null;
      provenance: Provenance;
    }
  | { kind: 'not-assessed'; verificationLevel: number | null; provenance: Provenance }
  | { kind: 'internal-account'; provenance: Provenance }
  | { kind: 'regulation-does-not-score'; regulation: string; provenance: Provenance }
  | { kind: 'never-calculated'; provenance: Provenance };

function provenanceOf(raw: RawProfile): Provenance {
  return {
    regulation: regulationName(raw.regulation),
    configurationVersion: raw.configurationVersion ?? null,
    countryId: raw.countryId ?? null,
    verificationLevel: raw.verificationLevel ?? null,
    recalculationReason: recalculationReasonName(raw.recalculationReason),
    updatedOn: raw.updatedOn ?? null,
    lastAnswerOccurredAt: raw.lastAnswerOccurredAt ?? null,
  };
}

/**
 * Exported because the monitoring section renders whenever a profile has monitoring data, which is
 * not the same set of profiles as the ones that reach `assessed`. Deriving the verdict twice from
 * two copies of these rules would be a way for the header and the section to disagree.
 */
export function deriveMonitoring(raw: RawProfile): MonitoringState {
  const m = raw.suitability?.ongoingMonitoring;
  // Reasons are whole sentences: they are rendered on their own line under the verdict, not
  // appended to it.
  if (!m) return { kind: 'not-evaluated', reason: 'No monitoring data on the profile.' };

  // Manual unblock wins over the comparison, matching the computed property on the service.
  if (m.manuallyUnblocked === true) return { kind: 'manually-unblocked' };

  const fsust = m.financialSustainability;
  const cu = m.copyUtilization;
  const noFsust = fsust === null || fsust === undefined;
  const noCu = cu === null || cu === undefined;

  // "Has not run" rather than "passed", and which side is missing rather than "one of them" —
  // a missing utilisation is the ordinary state of anyone who has never copied, while a missing
  // limit means the calculator could not produce one. Same verdict, entirely different follow-up.
  if (noFsust || noCu) {
    return {
      kind: 'not-evaluated',
      reason: noFsust && noCu
        ? 'Neither the sustainability limit nor copy utilisation is on the record, so the gate has not run.'
        : noFsust
          ? 'The record carries no sustainability limit, so there is nothing to measure utilisation against.'
          : 'The record carries no copy utilisation, which is the normal state for someone who has not copied anyone. There is nothing for the gate to check.',
    };
  }

  return cu > fsust
    ? { kind: 'blocked', financialSustainability: fsust, copyUtilization: cu }
    : { kind: 'within-limit', financialSustainability: fsust, copyUtilization: cu };
}

/**
 * Resolve the authorised risk score from the profile's *own* configuration version where
 * possible. Callers pass the mapping they loaded for that version; the fallback map is
 * only for when no config is available.
 */
export function authorizedRiskScore(
  level: RiskLevelName,
  fromConfig?: Readonly<Record<string, number>> | null,
): { score: number; fromConfig: boolean } {
  const configured = fromConfig?.[level];
  return configured === undefined
    ? { score: FALLBACK_AUTHORIZED_RISK_SCORE[level], fromConfig: false }
    : { score: configured, fromConfig: true };
}

export function deriveOutcome(
  raw: RawProfile | null,
  scoreMappings?: Readonly<Record<string, number>> | null,
): Outcome {
  if (!raw) {
    return {
      kind: 'never-calculated',
      provenance: {
        regulation: null,
        configurationVersion: null,
        countryId: null,
        verificationLevel: null,
        recalculationReason: null,
        updatedOn: null,
        lastAnswerOccurredAt: null,
      },
    };
  }

  const provenance = provenanceOf(raw);

  // Checked before anything else: an internal account's stored result is hardcoded, so
  // reading it as an assessment would be reading a placeholder as a fact.
  if (raw.countryId === COUNTRY_ETORO) {
    return { kind: 'internal-account', provenance };
  }

  if (
    raw.verificationLevel !== null &&
    raw.verificationLevel !== undefined &&
    raw.verificationLevel < MIN_VERIFICATION_LEVEL
  ) {
    return { kind: 'not-assessed', verificationLevel: raw.verificationLevel, provenance };
  }

  const level = riskLevelName(raw.suitability?.clientRiskLevel);

  if (!level) {
    const regulation = provenance.regulation;
    if (regulation && !SCORING_REGULATIONS.includes(regulation)) {
      return { kind: 'regulation-does-not-score', regulation, provenance };
    }
    return { kind: 'not-assessed', verificationLevel: raw.verificationLevel ?? null, provenance };
  }

  const { score, fromConfig } = authorizedRiskScore(level, scoreMappings);

  return {
    kind: 'assessed',
    riskLevel: level,
    authorizedRiskScore: score,
    scoreFromConfig: fromConfig,
    hardBlocked: isBlocked(raw.suitability?.suitabilityBlock),
    monitoring: deriveMonitoring(raw),
    isAllQuestionsAnswered: raw.suitability?.isAllQuestionsAnswered ?? null,
    provenance,
  };
}

/** Can this user copy a target whose risk score is `targetRiskScore`? */
export function verdictFor(
  outcome: Outcome,
  targetRiskScore: number,
): { allowed: boolean; reason: string } {
  if (outcome.kind !== 'assessed') {
    return { allowed: false, reason: 'No suitability result, so no cap can be applied' };
  }
  if (outcome.hardBlocked) {
    return { allowed: false, reason: 'Hard blocked from all copy activity' };
  }
  if (outcome.monitoring.kind === 'blocked') {
    return { allowed: false, reason: 'Blocked by ongoing monitoring — copy utilisation exceeds sustainability' };
  }
  if (targetRiskScore > outcome.authorizedRiskScore) {
    return {
      allowed: false,
      reason: `Target risk score ${targetRiskScore} exceeds the authorised ${outcome.authorizedRiskScore}`,
    };
  }
  return {
    allowed: true,
    reason: `Target risk score ${targetRiskScore} is within the authorised ${outcome.authorizedRiskScore}`,
  };
}
