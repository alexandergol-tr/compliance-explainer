/**
 * Reads configuration documents from `../config-prod/`, which holds the five live scoring
 * configs verbatim from production Cosmos.
 *
 * Reading them off disk rather than calling the service is deliberate for now: explainer
 * mode needs no credentials, no network and no data-plane grant, which is what lets it
 * ship before any access question is settled. Swapping to
 * `GET /ClientRiskProfileConfiguration/{regulation}/country/{countryId}/current` later is
 * a change to this module alone.
 *
 * Server-only — it touches the filesystem.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConfigDocument, LoadedConfig } from './types';

/** Relative to the app root, which is where Next runs. */
const CONFIG_DIR = join(process.cwd(), '..', 'config-prod');

function toLoaded(doc: ConfigDocument): LoadedConfig {
  const suitability = doc.Suitability;
  const factors = suitability?.RiskLevel?.Factors ?? [];

  const scoreMappings: Record<string, number> = {};
  for (const m of suitability?.RiskLevelToScoreMappings ?? []) {
    scoreMappings[m.RiskLevel] = m.AuthorizedRiskScore;
  }

  return {
    id: doc.id,
    regulation: doc.Regulation,
    version: doc.Version,
    updatedOn: doc.UpdatedOn ?? null,
    // A document can carry a Suitability block that is present but empty. That is how a
    // regulation stops scoring without the block being removed, so emptiness is the signal.
    scoresSuitability: factors.length > 0,
    defaultRiskLevel: suitability?.RiskLevel?.DefaultRiskLevel ?? null,
    rootOperation: suitability?.RiskLevel?.Operation ?? null,
    rootRounding: suitability?.RiskLevel?.Round ?? null,
    riskLevelWeight: suitability?.RiskLevelWeight ?? [],
    factors,
    scoreMappings,
    blockChecks: suitability?.SuitabilityBlock?.Checks ?? [],
    blockDefaultResult: suitability?.SuitabilityBlock?.DefaultResult ?? null,
  };
}

let cache: Promise<LoadedConfig[]> | null = null;

export function loadAllConfigs(): Promise<LoadedConfig[]> {
  cache ??= (async () => {
    const files = (await readdir(CONFIG_DIR)).filter((f) => f.endsWith('.json'));
    const docs = await Promise.all(
      files.map(async (file) => {
        const text = await readFile(join(CONFIG_DIR, file), 'utf8');
        return toLoaded(JSON.parse(text) as ConfigDocument);
      }),
    );
    return docs.sort(
      (a, b) => a.regulation.localeCompare(b.regulation) || a.version - b.version,
    );
  })();
  return cache;
}

export async function loadScoringConfigs(): Promise<LoadedConfig[]> {
  return (await loadAllConfigs()).filter((c) => c.scoresSuitability);
}

/** By document id, e.g. `CySEC-24`. */
export async function loadConfig(id: string): Promise<LoadedConfig | null> {
  return (await loadAllConfigs()).find((c) => c.id === id) ?? null;
}

/**
 * The config that produced a given result. Falls back to the highest version present when
 * the exact version is not in `config-prod/` — the directory holds current versions plus a
 * MAS trail, not the full 104-document history, so an older profile often has no exact match.
 */
export async function loadConfigFor(
  regulation: string | null,
  version: number | null,
): Promise<{ config: LoadedConfig | null; exact: boolean }> {
  if (!regulation) return { config: null, exact: false };
  const all = await loadAllConfigs();

  const exact = all.find((c) => c.regulation === regulation && c.version === version);
  if (exact) return { config: exact, exact: true };

  const latest = all
    .filter((c) => c.regulation === regulation)
    .sort((a, b) => b.version - a.version)[0];
  return { config: latest ?? null, exact: false };
}
