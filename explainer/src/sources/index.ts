/**
 * Which source is active.
 *
 * Fixtures unless something real is configured. The default is the safe one on purpose: an app
 * that reaches for real customer data because someone forgot to configure it is the wrong
 * failure direction.
 *
 * Cosmos is preferred over the REST API when both are configured, because it is the only one
 * that can supply the calculation tree and the answers — see `kycanalyzer/source.ts` for why
 * the API cannot.
 *
 * The two modes are not mutually exclusive. Fixture ids live in a reserved band that no real
 * GCID can occupy, so `sourceFor` routes them to the fixtures even when a real source is
 * configured. Without that, configuring Cosmos silently breaks every worked example: the id
 * gets looked up for real, is not found, and the page reports "no stored profile" — which is
 * true of Cosmos and a lie about the fixture. The eventual split between a wide-access
 * explainer mode and a restricted lookup mode needs both to work in one process anyway.
 */

import { FixtureSource } from './fixtures';
import { CosmosProfileSource } from './cosmos/source';
import { cosmosConfig } from './cosmos/read-only-client';
import { DatabricksIdentitySource, databricksConfig } from './identity/databricks';
import { KycAnalyzerSource } from './kycanalyzer/source';
import { readClientConfig } from './kycanalyzer/read-only-client';
import type { IdentitySource } from './identity/types';
import type { ProfileSource } from './types';

/**
 * Reserved for synthetic profiles. Real GCIDs are eight digits, so this band is unreachable
 * for a live customer; the examples currently occupy 1001–1014.
 */
export const FIXTURE_ID_MIN = 1000;
export const FIXTURE_ID_MAX = 1099;

export function isFixtureId(id: number): boolean {
  return Number.isInteger(id) && id >= FIXTURE_ID_MIN && id <= FIXTURE_ID_MAX;
}

let active: ProfileSource | null = null;
let fixtures: FixtureSource | null = null;

/**
 * The identity map, if configured. Optional on purpose: without it GCID lookup still works and
 * CID lookup reports that it is switched off, which is a better failure than guessing.
 */
export function identitySource(): IdentitySource | null {
  return databricksConfig() ? new DatabricksIdentitySource() : null;
}

/** The configured source — what the header describes and what an unknown id goes to. */
export function activeSource(): ProfileSource {
  active ??= cosmosConfig()
    ? new CosmosProfileSource(identitySource())
    : readClientConfig()
      ? new KycAnalyzerSource()
      : new FixtureSource();
  return active;
}

export function fixtureSource(): FixtureSource {
  fixtures ??= new FixtureSource();
  return fixtures;
}

/** The source that owns a given id. Use this for anything id-shaped; never assume the active one. */
export function sourceFor(id: number): ProfileSource {
  return isFixtureId(id) ? fixtureSource() : activeSource();
}

export { CosmosProfileSource, DatabricksIdentitySource, FixtureSource, KycAnalyzerSource };
export * from './types';
