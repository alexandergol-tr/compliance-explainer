/**
 * A read-only Cosmos client, hand-rolled over the REST API.
 *
 * Why not the SDK: the SDK's surface includes `upsert`, `delete`, `replace` and stored-procedure
 * execution on the same container handle used to read. The guardrail in the handoff pack is that
 * writes should be structurally impossible rather than merely avoided, and the cheapest way to
 * get that is a module whose only exported function issues a document query. There is no code
 * path here that can mutate anything.
 *
 * Two further deliberate restrictions:
 *
 *   - **Read-only key required.** `COSMOS_READONLY_KEY` is expected to be the account's
 *     `primaryReadonlyMasterKey`. A read-write key would work identically, which is exactly why
 *     the variable is named for the one you should supply.
 *   - **Point queries only.** Every query must target a single partition. The container is
 *     partitioned by `/id` (the GCID), so a profile lookup is naturally single-partition, and
 *     refusing to fan out means this client cannot be turned into a customer-data scanner by
 *     someone passing a different WHERE clause.
 */

import { createHmac } from 'node:crypto';

export interface CosmosConfig {
  account: string;
  database: string;
  key: string;
}

export class CosmosNotConfigured extends Error {
  constructor(readonly missing: string[]) {
    super(`Cosmos source is not configured. Missing: ${missing.join(', ')}.`);
    this.name = 'CosmosNotConfigured';
  }
}

export function cosmosConfig(): CosmosConfig | null {
  const account = process.env.COSMOS_ACCOUNT;
  const key = process.env.COSMOS_READONLY_KEY;
  if (!account || !key) return null;
  return { account, key, database: process.env.COSMOS_DATABASE ?? 'KycAnalyzer' };
}

export function requireCosmosConfig(): CosmosConfig {
  const config = cosmosConfig();
  if (config) return config;
  const missing: string[] = [];
  if (!process.env.COSMOS_ACCOUNT) missing.push('COSMOS_ACCOUNT');
  if (!process.env.COSMOS_READONLY_KEY) missing.push('COSMOS_READONLY_KEY');
  throw new CosmosNotConfigured(missing);
}

/**
 * Cosmos signs the resource path, the verb, the resource type and the date, all lowercased,
 * newline-separated, with a trailing empty line. Getting any part of that wrong yields a 401
 * with no hint as to which part, so it is written out literally rather than built up.
 */
function authorization(verb: string, resourceType: string, resourceLink: string, date: string, key: string): string {
  const payload = `${verb}\n${resourceType}\n${resourceLink}\n${date}\n\n`;
  const signature = createHmac('sha256', Buffer.from(key, 'base64')).update(payload, 'utf8').digest('base64');
  return encodeURIComponent(`type=master&ver=1.0&sig=${signature}`);
}

export class CosmosQueryError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Cosmos query failed with HTTP ${status}`);
    this.name = 'CosmosQueryError';
  }
}

/**
 * Turns a Cosmos failure into something a reader can act on.
 *
 * The one worth separating is the account firewall. It answers 403 with the *caller's* IP in
 * the body, which is the whole diagnosis — the key is valid, the query is valid, and the
 * request never reached the data. Rendered as a generic error it reads like a broken app or a
 * dead credential, and the next hour goes into re-checking both.
 */
export function describeCosmosFailure(error: CosmosQueryError): {
  title: string;
  detail: string;
  blockedIp: string | null;
} {
  const blockedIp = error.status === 403
    ? (/from IP ([0-9a-fA-F.:]+)/.exec(error.body)?.[1] ?? null)
    : null;

  if (blockedIp) {
    return {
      title: 'Blocked by the Cosmos account firewall',
      detail:
        `The account rejected this request because it came from ${blockedIp}, which is not on its ` +
        'IP allowlist. Nothing is wrong with the credential or the query — the request never reached ' +
        'the data. Connect from an allowlisted network, or have the address added.',
      blockedIp,
    };
  }

  if (error.status === 401) {
    return {
      title: 'Cosmos rejected the credential',
      detail:
        'The read-only key was refused. Most likely it has been rotated since this process started; ' +
        'restarting with a freshly fetched key is the first thing to try.',
      blockedIp: null,
    };
  }

  if (error.status === 429) {
    return {
      title: 'Rate limited by Cosmos',
      detail: 'The account throttled this request. Retrying shortly should work.',
      blockedIp: null,
    };
  }

  return {
    title: `Cosmos returned HTTP ${error.status}`,
    detail: error.body.slice(0, 300),
    blockedIp: null,
  };
}

/**
 * Runs a single-partition document query.
 *
 * `partitionKey` is mandatory, which is what keeps this a lookup rather than a scan: without
 * it the REST gateway rejects the query with a 400 telling the SDK to fan out over partition
 * ranges, and nothing here does that.
 */
export async function queryOnePartition<T>(
  container: string,
  partitionKey: string,
  query: string,
  parameters: { name: string; value: unknown }[],
  config: CosmosConfig,
): Promise<T[]> {
  const resourceLink = `dbs/${config.database}/colls/${container}`;
  const date = new Date().toUTCString().toLowerCase();

  const response = await fetch(`https://${config.account}.documents.azure.com/${resourceLink}/docs`, {
    method: 'POST',
    headers: {
      Authorization: authorization('post', 'docs', resourceLink, date, config.key),
      'x-ms-date': date,
      'x-ms-version': '2018-12-31',
      'x-ms-documentdb-isquery': 'true',
      'x-ms-documentdb-partitionkey': JSON.stringify([partitionKey]),
      'x-ms-max-item-count': '10',
      'Content-Type': 'application/query+json',
    },
    body: JSON.stringify({ query, parameters }),
    cache: 'no-store',
  });

  const text = await response.text();
  if (!response.ok) throw new CosmosQueryError(response.status, text.slice(0, 800));
  return (JSON.parse(text).Documents ?? []) as T[];
}
