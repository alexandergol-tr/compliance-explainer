/**
 * The engine's risk-level arithmetic, shared by the node aggregations and the per-question ones.
 *
 * A level is not a number to the engine — it is a key into a weight table on the configuration
 * document, and every `Min`, `Max` and `Avg` runs over those weights before mapping back. Both
 * the parent-node explanations (`arithmetic.ts`) and the per-question ones (`leaf.ts`) need the
 * identical routine, and a second copy of it would be a second chance to diverge from the engine.
 *
 * ## The two averaging paths
 *
 * `SuitabilityRiskLevelCalculator` passes a different configuration object depending on the node,
 * and the two take different code paths:
 *
 *   - **Factors, the root, and every question** use the flat `SuitabilityConfiguration`
 *     (`RiskLevelExtensions`). Averaging is `Math.Truncate(mean)` against the document scale,
 *     mapped back by *exact weight match*. The document scale is `0..4`, so a truncated mean is
 *     always an integer in range and always matches.
 *   - **Components** use `NestedSuitabilityConfiguration`, but only for `Avg`, and only when the
 *     component declares its own `RiskLevelWeight`. `GetMin` / `GetMax` on the nested type
 *     delegate straight back to the flat one, so a component's own scale is invisible to them.
 *     That path averages over the component scale and truncates to the nearest multiple of 100.
 *
 * Component 9 is the only component in any live config with its own scale, and it is `Avg`, so the
 * delegation quirk never bites today. It is modelled anyway: the day a second component gets a
 * scale, a `Max` over it would silently use the document scale, and an explanation that quietly
 * used the other one would be wrong in a way nobody would catch.
 *
 * Note that questions under Component 9 still use the *document* scale, because
 * `CalculateQuestionResult` is handed the flat configuration. Only the component's own
 * aggregation sees the component scale.
 *
 * One deliberate infidelity, in the engine's favour: the nested path calls `Convert.ToInt32`,
 * which rounds half to even rather than truncating. `roundHalfToEven` reproduces it, but it can
 * only change the outcome when the mean lands in `[x99.5, x00)`, which needs at least 200
 * children. The deepest node has seven.
 */

import type { Operation, RiskLevelWeight, Rounding } from '@/config/types';
import type { RiskLevelName } from './ids';

export interface Scale {
  byLevel: Map<RiskLevelName, number>;
  byWeight: Map<number, RiskLevelName>;
}

export function toScale(weights: RiskLevelWeight[] | null | undefined): Scale | null {
  if (!weights || weights.length === 0) return null;
  const byLevel = new Map<RiskLevelName, number>();
  const byWeight = new Map<number, RiskLevelName>();
  for (const entry of weights) {
    byLevel.set(entry.RiskLevel, entry.Weight);
    // First declaration wins, matching `FirstOrDefault`.
    if (!byWeight.has(entry.Weight)) byWeight.set(entry.Weight, entry.RiskLevel);
  }
  return { byLevel, byWeight };
}

/** `Round.Up = 1, Round.Down = 2`. Anything else — including the stray `0` — is unset. */
export function readRounding(round: Rounding | undefined): 'Down' | 'Up' | null {
  if (round === 'Down' || round === 2) return 'Down';
  if (round === 'Up' || round === 1) return 'Up';
  return null;
}

/** `Convert.ToInt32(double)` in .NET: nearest, ties to even. */
export function roundHalfToEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (fraction > 0.5) return lower + 1;
  if (fraction < 0.5) return lower;
  return lower % 2 === 0 ? lower : lower + 1;
}

function truncateToLowerMultiple(value: number, multiple: number): number {
  return Math.floor(value / multiple) * multiple;
}

function truncateToHigherMultiple(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

export const COMPONENT_SCALE_MULTIPLE = 100;

export interface Computed {
  level: RiskLevelName | null;
  /** The weight the operation landed on, after any rounding. */
  weight: number;
  mean: number | null;
  scale: 'document' | 'component';
}

export function compute(
  operation: Operation,
  rounding: 'Down' | 'Up' | null,
  levels: RiskLevelName[],
  documentScale: Scale,
  componentScale: Scale | null,
): Computed | null {
  if (levels.length === 0) return null;

  // Min and Max always run against the document scale, even on a component that declares its
  // own — the nested overloads delegate to the flat ones.
  if (operation === 'Min' || operation === 'Max') {
    const weights = levels.map((level) => documentScale.byLevel.get(level));
    if (weights.some((w) => w === undefined)) return null;
    const chosen = operation === 'Min'
      ? Math.min(...(weights as number[]))
      : Math.max(...(weights as number[]));
    return {
      level: documentScale.byWeight.get(chosen) ?? null,
      weight: chosen,
      mean: null,
      scale: 'document',
    };
  }

  if (operation !== 'Avg') return null;

  if (componentScale) {
    const weights = levels.map((level) => componentScale.byLevel.get(level));
    if (weights.some((w) => w === undefined)) return null;
    const mean = (weights as number[]).reduce((a, b) => a + b, 0) / weights.length;
    const rounded = roundHalfToEven(mean);
    const truncated = rounding === 'Down'
      ? truncateToLowerMultiple(rounded, COMPONENT_SCALE_MULTIPLE)
      : truncateToHigherMultiple(rounded, COMPONENT_SCALE_MULTIPLE);
    return {
      level: componentScale.byWeight.get(truncated) ?? null,
      weight: truncated,
      mean,
      scale: 'component',
    };
  }

  const weights = levels.map((level) => documentScale.byLevel.get(level));
  if (weights.some((w) => w === undefined)) return null;
  const mean = (weights as number[]).reduce((a, b) => a + b, 0) / weights.length;
  // The engine's round-up branch is `Truncate(mean - 0.0001) + 1`, not `Ceiling`. They differ on
  // exact integers, where this yields mean + 1 rather than mean.
  const weight = rounding === 'Down'
    ? Math.trunc(mean)
    : Math.trunc(mean - 0.0001) + 1;
  return { level: documentScale.byWeight.get(weight) ?? null, weight, mean, scale: 'document' };
}
