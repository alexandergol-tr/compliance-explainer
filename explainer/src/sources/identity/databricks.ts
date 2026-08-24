/**
 * CID <-> GCID via the lake mirror of the identity system of record.
 *
 * `main.compliance.bronze_userapidb_customer_customeridentification` mirrors UserApiDB's
 * `Customer.CustomerIdentification`, which is the table eToro assigns identifiers into at
 * registration. Measured: 48,867,085 rows, one per human, every one of `GCID`, `CID` and
 * `DemoCID` populated and distinct.
 *
 * It is a **bronze mirror on a 1440-minute full-override refresh**, so it lags the source by up
 * to a day and holds no history. For an id assigned years ago — which is every id anyone
 * investigates a suitability cap for — that is irrelevant. For a customer who registered this
 * morning it means "not found", so that possibility is worth remembering before concluding an
 * id is bogus.
 *
 * Chosen over the live service path on purpose. KYCAnalyzer resolves CIDs through UserApi's
 * `GET /api/v1/users?realCid=`, whose `BasicUserInfo` DTO declares `Gcid` and a `Cid` bound to
 * the JSON property `RealCid` — and no `DemoCid` at all. That route therefore cannot tell a
 * demo CID from a nonexistent one, which is exactly the diagnosis this app needs to be able to
 * make. `[code]` KYCAnalyzer/eToro.KYCAnalyzerService.Infrastructure/Providers/UserAPIProvider.cs,
 * `[code]` .../Domain/Providers/Models/UserAPI/BasicUserInfo.cs.
 *
 * Read-only by construction, in the same spirit as the Cosmos client: the SQL is a private
 * constant in this module, callers pass an integer and nothing else, and the only exported
 * behaviour is a lookup. There is no code path here that can send caller-supplied SQL.
 */

import {
  IdentityLookupError,
  IdentityNotConfigured,
  type IdentityLookup,
  type IdentityRecord,
  type IdentitySource,
} from './types';

const TABLE = 'main.compliance.bronze_userapidb_customer_customeridentification';

/**
 * One statement, three probes.
 *
 * A named parameter marker may repeat, so `:id` is bound once and reused.
 *
 * Note what this costs. The upstream table indexes `GCID` and `CID`, but none of that survives
 * into the lake — the mirror is an external *parquet* table, so all three branches are scans.
 * They are cheap scans (three `int` columns out of eight, so column pruning does most of the
 * work) but they are still seconds rather than milliseconds, which is the reason the cache below
 * exists rather than being an optimisation nobody needed.
 *
 * Three branches in one statement rather than three round trips for the same reason.
 */
const LOOKUP_SQL = `
  SELECT 'gcid' AS space, GCID AS gcid, CID AS real_cid, DemoCID AS demo_cid
    FROM ${TABLE} WHERE GCID = :id
  UNION ALL
  SELECT 'cid' AS space, GCID, CID, DemoCID
    FROM ${TABLE} WHERE CID = :id
  UNION ALL
  SELECT 'demo-cid' AS space, GCID, CID, DemoCID
    FROM ${TABLE} WHERE DemoCID = :id
`;

export interface DatabricksConfig {
  host: string;
  token: string;
  warehouseId: string;
}

export function databricksConfig(): DatabricksConfig | null {
  const host = process.env.DATABRICKS_HOST;
  const token = process.env.DATABRICKS_TOKEN;
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!host || !token || !warehouseId) return null;
  // Tolerate a pasted browser URL; the API wants a bare host.
  return { host: host.replace(/^https?:\/\//, '').replace(/\/+$/, ''), token, warehouseId };
}

export function requireDatabricksConfig(): DatabricksConfig {
  const config = databricksConfig();
  if (config) return config;
  const missing = (['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_WAREHOUSE_ID'] as const).filter(
    (k) => !process.env[k],
  );
  throw new IdentityNotConfigured([...missing]);
}

interface StatementResponse {
  status?: { state?: string; error?: { error_code?: string; message?: string } };
  result?: { data_array?: (string | null)[][] };
}

function toRecord(row: (string | null)[]): IdentityRecord {
  const [, gcid, realCid, demoCid] = row;
  return {
    gcid: Number(gcid),
    realCid: Number(realCid),
    demoCid: demoCid === null ? null : Number(demoCid),
  };
}

/**
 * The mapping is assigned once at registration and never reissued, so a hit can be kept for the
 * life of the process. Bounded because this is a long-running dev server and an unbounded map
 * keyed by operator input is a slow leak. Misses are cached too — repeatedly asking the lake
 * about a typo is the common case.
 */
const CACHE_LIMIT = 2_000;
const cache = new Map<number, IdentityLookup>();

function remember(id: number, lookup: IdentityLookup): IdentityLookup {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(id, lookup);
  return lookup;
}

export class DatabricksIdentitySource implements IdentitySource {
  readonly label = 'UserApiDB CustomerIdentification (lake mirror)';

  constructor(private readonly config: DatabricksConfig = requireDatabricksConfig()) {}

  async lookup(id: number): Promise<IdentityLookup> {
    const cached = cache.get(id);
    if (cached) return cached;

    const response = await fetch(`https://${this.config.host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        statement: LOOKUP_SQL,
        warehouse_id: this.config.warehouseId,
        parameters: [{ name: 'id', value: String(id), type: 'INT' }],
        format: 'JSON_ARRAY',
        disposition: 'INLINE',
        // A cold warehouse takes tens of seconds to wake. Waiting inline is the right trade for
        // an interactive lookup; cancelling on timeout avoids leaving a statement running.
        wait_timeout: '30s',
        on_wait_timeout: 'CANCEL',
      }),
      cache: 'no-store',
    });

    const text = await response.text();
    if (!response.ok) {
      throw new IdentityLookupError(response.status, describeHttpFailure(response.status, text));
    }

    const body = JSON.parse(text) as StatementResponse;
    if (body.status?.state !== 'SUCCEEDED') {
      throw new IdentityLookupError(
        200,
        body.status?.error?.message ??
          `The warehouse returned state ${body.status?.state ?? 'UNKNOWN'} instead of a result. ` +
            'A pending state here means the warehouse did not wake within 30 seconds; retrying ' +
            'usually finds it warm.',
      );
    }

    const rows = body.result?.data_array ?? [];
    const find = (space: string) => {
      const row = rows.find((r) => r[0] === space);
      return row ? toRecord(row) : null;
    };

    return remember(id, {
      asGcid: find('gcid'),
      asRealCid: find('cid'),
      asDemoCid: find('demo-cid'),
    });
  }
}

function describeHttpFailure(status: number, body: string): string {
  const message = (() => {
    try {
      return (JSON.parse(body) as { message?: string }).message ?? body.slice(0, 300);
    } catch {
      return body.slice(0, 300);
    }
  })();

  if (status === 401 || status === 403) {
    return (
      'Databricks refused the token. Either it has expired, or it belongs to a principal without ' +
      `SELECT on ${TABLE}. Upstream said: ${message}`
    );
  }
  if (status === 404) {
    return `No such warehouse — check DATABRICKS_WAREHOUSE_ID. Upstream said: ${message}`;
  }
  return `Databricks returned HTTP ${status}. ${message}`;
}
