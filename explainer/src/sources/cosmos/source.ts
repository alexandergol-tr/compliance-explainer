/**
 * Cosmos `ClientRiskProfile` — the only source that holds both the calculation tree and the
 * user's answers, which are the two things this app exists to show.
 *
 * The document is stored close to the domain model, so translation is thin. Field-name casing
 * is PascalCase on the wire and camelCase in the domain layer, and that is handled in one
 * place (`toCamel`) rather than per-field.
 *
 * Two shape facts, measured rather than assumed (578 trees, 7,231 question nodes):
 *
 *   - Enums serialise as **names**, not ids: `Regulation: "CySEC"`, `ClientRiskLevel: "Medium"`,
 *     `SuitabilityBlock: "NotBlocked"`. The exception is `QuestionsAnswers`, whose `QuestionId`
 *     and `AnswerIds` are numeric. The domain layer accepts `number | string` for exactly this
 *     reason, so nothing needs converting here.
 *   - Whole sections are **absent** rather than empty for users the engine did not score. A MAS
 *     user has no `Suitability` property at all, so `suitability` arrives `undefined` and the
 *     outcome layer reports "this regulation does not score" instead of inventing a risk level.
 */

import type {
  IdKind,
  OtherSpace,
  ProfileSource,
  RawProfile,
  Resolution,
  SourceCapabilities,
} from '../types';
import type { IdentityLookup, IdentitySource } from '../identity/types';
import { queryOnePartition, requireCosmosConfig } from './read-only-client';

function toCamel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => toCamel(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      // Cosmos system fields (_rid, _etag, _ts) are noise; drop them at the boundary.
      if (key.startsWith('_')) continue;
      out[key.charAt(0).toLowerCase() + key.slice(1)] = toCamel(v);
    }
    return out as T;
  }
  return value as T;
}

/** The spaces a number is valid in, other than the one it was read as. */
function otherSpaces(lookup: IdentityLookup, exclude: OtherSpace): OtherSpace[] {
  const present: OtherSpace[] = [];
  if (lookup.asGcid) present.push('gcid');
  if (lookup.asRealCid) present.push('cid');
  if (lookup.asDemoCid) present.push('demo-cid');
  return present.filter((s) => s !== exclude);
}

export class CosmosProfileSource implements ProfileSource {
  readonly id = 'cosmos';
  readonly label = 'Cosmos ClientRiskProfile (real customer data)';
  readonly isRealData = true;
  readonly capabilities: SourceCapabilities = { tree: true, answers: true };

  /**
   * Identity is injected rather than reached for, because the app has to stay usable without it.
   * With no identity source a GCID still works (the profile store is keyed by it); only CID
   * resolution goes dark, and it says so instead of falling back to trying the number as a GCID.
   */
  constructor(private readonly identity: IdentitySource | null = null) {}

  async getProfile(gcid: number): Promise<RawProfile | null> {
    const config = requireCosmosConfig();
    // The container is partitioned by `/id`, and `id` is the GCID as a string.
    const documents = await queryOnePartition<Record<string, unknown>>(
      'ClientRiskProfile',
      String(gcid),
      'SELECT * FROM c WHERE c.id = @id',
      [{ name: '@id', value: String(gcid) }],
      config,
    );
    if (documents.length === 0) return null;
    return toCamel<RawProfile>(documents[0]);
  }

  /**
   * Identity first, profile second.
   *
   * With an identity source, "is this a user?" and "does that user have a stored calculation?"
   * are answered separately, which matters: a valid GCID with no profile document is a real and
   * informative state (the engine never scored them) and it should reach the profile page to be
   * explained there, not be turned into "no user found" here.
   *
   * Without one, GCID falls back to profile existence and CID is refused outright. Refusing is
   * the point — the previous behaviour tried a CID as a GCID, and since 99% of GCIDs are also
   * somebody's real CID, that silently rendered the wrong customer.
   */
  async resolve(id: number, kind: IdKind): Promise<Resolution> {
    if (!this.identity) {
      if (kind === 'cid') {
        return {
          kind: 'unavailable',
          reason:
            'Profile documents hold no CID, so this source cannot resolve one on its own, and ' +
            'trying the number as a GCID instead would land on a different customer 99% of the ' +
            'time. Configure the identity source (DATABRICKS_HOST, DATABRICKS_TOKEN, ' +
            'DATABRICKS_WAREHOUSE_ID) or enter a GCID.',
        };
      }
      const profile = await this.getProfile(id);
      return profile
        ? { kind: 'resolved', user: { gcid: id, cid: null, username: null }, via: 'gcid', alsoValidAs: [] }
        : { kind: 'not-found', id, tried: 'gcid', alsoValidAs: [] };
    }

    const lookup = await this.identity.lookup(id);

    if (kind === 'gcid') {
      return lookup.asGcid
        ? {
            kind: 'resolved',
            user: { gcid: id, cid: lookup.asGcid.realCid, username: null },
            via: 'gcid',
            alsoValidAs: otherSpaces(lookup, 'gcid'),
          }
        : { kind: 'not-found', id, tried: 'gcid', alsoValidAs: otherSpaces(lookup, 'gcid') };
    }

    if (lookup.asRealCid) {
      return {
        kind: 'resolved',
        user: { gcid: lookup.asRealCid.gcid, cid: id, username: null },
        via: 'cid',
        alsoValidAs: otherSpaces(lookup, 'cid'),
      };
    }
    // Not a real CID but a known demo one. Reported as its own state, because "no such customer"
    // would be false — there is a customer, they are just reachable only by their real ids.
    if (lookup.asDemoCid) return { kind: 'demo-cid', id };
    return { kind: 'not-found', id, tried: 'cid', alsoValidAs: otherSpaces(lookup, 'cid') };
  }

  async list() {
    // Never enumerate real users.
    return [];
  }
}
