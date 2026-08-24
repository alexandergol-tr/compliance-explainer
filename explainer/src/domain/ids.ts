/**
 * Identifier maps and orderings.
 *
 * Most of these are generated from the C# enums — see `generated/kyc-enums.ts`.
 * What lives here is the handful that either has no enum to generate from, or
 * that carries meaning the enum does not express (ordering, defaults).
 */

import {
  BlockResultNames,
  RecalculationReasonNames,
  RegulationNames,
  RiskLevelNames,
} from './generated/kyc-enums';

export { BlockResultNames, RecalculationReasonNames, RegulationNames, RiskLevelNames };

/** `RiskLevel` ids are 100..500, not 1..5. */
export type RiskLevelName = 'Minimal' | 'Low' | 'Medium' | 'MediumHigh' | 'High';

/**
 * Ascending risk. The engine's `Min` / `Max` / `Avg` factor operations are defined
 * over this ordering, so it is load-bearing rather than presentational.
 */
export const RISK_LEVELS_ASCENDING: readonly RiskLevelName[] = [
  'Minimal',
  'Low',
  'Medium',
  'MediumHigh',
  'High',
];

/** `MediumHigh` is the only one that needs help. Shared so prose and badges never disagree. */
export const RISK_LEVEL_DISPLAY: Readonly<Record<RiskLevelName, string>> = {
  Minimal: 'Minimal',
  Low: 'Low',
  Medium: 'Medium',
  MediumHigh: 'Medium-High',
  High: 'High',
};

export function riskLevelDisplay(level: RiskLevelName | null | undefined): string {
  return level ? RISK_LEVEL_DISPLAY[level] : 'no level';
}

/**
 * Fallback only. The real mapping is `RiskLevelToScoreMappings` on the user's own
 * configuration version and must be read from there — it is per-version, and hardcoding
 * it is how an app drifts from the engine. Used when no config is loaded.
 *
 * `Minimal` and `Low` deliberately collapse to 3 (tech.md §4.4).
 */
export const FALLBACK_AUTHORIZED_RISK_SCORE: Readonly<Record<RiskLevelName, number>> = {
  Minimal: 3,
  Low: 3,
  Medium: 6,
  MediumHigh: 8,
  High: 10,
};

export type NodeLevel = 'factor' | 'component' | 'question';

/**
 * `SuitabilityCalculationDetailLevel` — the tree-node discriminator.
 *
 * Declared in the service at KYCAnalyzer/eToro.KYCAnalyzerService.Domain/ClientRiskProfile/
 * Models/SuitabilityResults/Enums/, and used by the SQL projection, which writes the level
 * into its own column.
 *
 * It is **not** present on the Cosmos documents — zero of 7,231 production tree nodes carry
 * it. Kept here for the SQL path only. Do not reach for it when reading Cosmos; use depth.
 */
export const DetailLevelNames: Readonly<Record<number, NodeLevel>> = {
  1: 'factor',
  2: 'component',
  3: 'question',
};

/**
 * Depth-to-level. This is the mechanism for Cosmos-sourced trees, not a fallback: the stored
 * documents carry no discriminator, and the tree is always exactly three levels deep.
 */
export const LEVEL_BY_DEPTH: readonly NodeLevel[] = ['factor', 'component', 'question'];

/**
 * Regulations whose *current* configuration version runs a suitability test. Everything else
 * ships a config with no `Suitability` block at all and gates copy trading by other means, in
 * which case the stored profile has no `Suitability` property (tech.md §6.1).
 *
 * Read from the live configuration container, 2026-08-11: 106 documents across 14 regulations,
 * of which these five have a non-empty `Suitability.RiskLevel.Factors` at their latest version.
 * MAS is the notable absence — it scored at v1–v2 and had the test removed from v3 onwards.
 * Offshore dropped it at v2 and FINRA at v6; FINRAONLY and NYDFSFINRA never had it.
 *
 * Test for factors, not for the presence of the `Suitability` object. eToroUS, FinCEN and NFA
 * all carry a `Suitability` block and none of them score — checking `IS_DEFINED(c.Suitability)`
 * counts them in and is how you end up telling a user their regulation scores when it does not.
 *
 * This is a fallback for display only. Whether a given *user* was scored depends on the
 * configuration version stamped on their profile, not on the current one, so prefer reading
 * their own version over consulting this list.
 */
export const SCORING_REGULATIONS: readonly string[] = [
  'CySEC',
  'FCA',
  'ASIC',
  'ASICGAML',
  'FSRA',
];

export function regulationName(id: number | string | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  if (typeof id === 'string') return id;
  return RegulationNames[id] ?? `Regulation ${id}`;
}

export function riskLevelName(id: number | string | null | undefined): RiskLevelName | null {
  if (id === null || id === undefined) return null;
  const name = typeof id === 'string' ? id : RiskLevelNames[id];
  return RISK_LEVELS_ASCENDING.includes(name as RiskLevelName) ? (name as RiskLevelName) : null;
}

/** `Blocked = 1`, `NotBlocked = 2` — 1 is the *bad* state, so truthiness is misleading. */
export function isBlocked(value: number | string | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  const name = typeof value === 'string' ? value : BlockResultNames[value];
  if (name === 'Blocked') return true;
  if (name === 'NotBlocked') return false;
  return null;
}

export function recalculationReasonName(id: number | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  // There is no reason 6; a gap is not an error.
  return RecalculationReasonNames[id] ?? `Unknown reason (${id})`;
}
