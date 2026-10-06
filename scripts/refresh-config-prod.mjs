#!/usr/bin/env node
/**
 * Refreshes config-prod/ from the live `ClientRiskProfileConfiguration` Cosmos container.
 *
 * Scope is deliberately narrow and read-only:
 *
 *   - Only the `ClientRiskProfileConfiguration` container. This script has no code path that
 *     can reach `ClientRiskProfile`, which holds per-customer answers — see AGENTS.md and
 *     explainer/src/sources/cosmos/read-only-client.ts for why that line matters here.
 *   - Only the regulations already mirrored under config-prod/, derived from the files on disk
 *     rather than hardcoded. It will never *add* a regulation outside the existing eight-document
 *     cut (see README.md) — catching up CySEC/FCA/ASIC/etc. is in scope, pulling in FINRA or
 *     Offshore because they happen to exist in Cosmos is not.
 *   - Only the current highest version per regulation. If prod skipped versions (ASIC GAML went
 *     15 -> 18 in one run of this), the intermediate documents are NOT backfilled — they are
 *     listed in the summary as skipped so a reviewer knows the gap exists, consistent with how
 *     this was done by hand before this script existed.
 *
 * This script never commits or opens anything. It writes files under config-prod/ and a
 * Markdown summary to stdout (and $GITHUB_STEP_SUMMARY when run in Actions). The calling
 * workflow decides whether a diff exists and what to do about it.
 *
 * Local usage:
 *   COSMOS_ACCOUNT=prod-kycanalyzer COSMOS_READONLY_KEY=... node scripts/refresh-config-prod.mjs
 *
 * ## Why "in-place mutation" gets its own loud category
 *
 * The app's whole "is this the exact config that produced this result" check
 * (`loadConfigFor` in explainer/src/config/load.ts) assumes a document id, once written, never
 * changes shape. That assumption broke once already in production: `MAS-12` gained a real
 * `EtfNegativeMarket` block with no version bump, silently invalidating what nm-formulas.md and
 * AGENTS.md say about it ("EtfNegativeMarket is not on MAS-12.json"). A same-id content change is
 * therefore reported as a distinct, more alarming finding than an ordinary new version, because a
 * normal diff view will not tell a reviewer that two users both labelled "scored under MAS-12" may
 * have been scored by different rules.
 */

import { createHmac } from 'node:crypto';
import { readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config-prod');
const CONTAINER = 'ClientRiskProfileConfiguration';
// Outside the repo tree on purpose — this is the PR body, not a tracked file, and writing it
// under config-prod/'s parent would otherwise get swept into the refresh commit itself.
const SUMMARY_PATH = join(process.env.RUNNER_TEMP ?? tmpdir(), 'config-prod-refresh-summary.md');

function env(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required env var ${name}`);
  return value;
}

function authorization(verb, resourceType, resourceLink, date, key) {
  const payload = `${verb}\n${resourceType}\n${resourceLink}\n${date}\n\n`;
  const signature = createHmac('sha256', Buffer.from(key, 'base64'))
    .update(payload, 'utf8')
    .digest('base64');
  return encodeURIComponent(`type=master&ver=1.0&sig=${signature}`);
}

function stripCosmosMetadata(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('_')) continue;
    out[k] = v;
  }
  return out;
}

async function cosmosGet(cosmos, id) {
  const resourceLink = `dbs/${cosmos.database}/colls/${CONTAINER}/docs/${id}`;
  const date = new Date().toUTCString().toLowerCase();
  const response = await fetch(`https://${cosmos.account}.documents.azure.com/${resourceLink}`, {
    method: 'GET',
    headers: {
      Authorization: authorization('get', 'docs', resourceLink, date, cosmos.key),
      'x-ms-date': date,
      'x-ms-version': '2018-12-31',
      'x-ms-documentdb-partitionkey': JSON.stringify([id]),
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${id} failed: HTTP ${response.status}: ${text.slice(0, 300)}`);
  return stripCosmosMetadata(JSON.parse(text));
}

/** Cross-partition, but this container holds formulas, not customer data — see file header. */
async function cosmosListInventory(cosmos) {
  const resourceLink = `dbs/${cosmos.database}/colls/${CONTAINER}`;
  let all = [];
  let continuation;
  do {
    const date = new Date().toUTCString().toLowerCase();
    const headers = {
      Authorization: authorization('post', 'docs', resourceLink, date, cosmos.key),
      'x-ms-date': date,
      'x-ms-version': '2018-12-31',
      'x-ms-documentdb-isquery': 'true',
      'x-ms-documentdb-query-enablecrosspartition': 'true',
      'x-ms-max-item-count': '100',
      'Content-Type': 'application/query+json',
    };
    if (continuation) headers['x-ms-continuation'] = continuation;
    const response = await fetch(`https://${cosmos.account}.documents.azure.com/${resourceLink}/docs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: 'SELECT c.id, c.Regulation, c.Version, c.UpdatedOn FROM c', parameters: [] }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Inventory query failed: HTTP ${response.status}: ${text.slice(0, 300)}`);
    all = all.concat(JSON.parse(text).Documents ?? []);
    continuation = response.headers.get('x-ms-continuation');
  } while (continuation);
  return all;
}

function flatten(obj, path = '$') {
  const out = {};
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => Object.assign(out, flatten(v, `${path}[${i}]`)));
  } else if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) Object.assign(out, flatten(v, `${path}.${k}`));
  } else {
    out[path] = obj;
  }
  return out;
}

/** Cheap heuristic: does this diff touch anything that could change a scored outcome? */
function touchesScoring(before, after) {
  const fb = flatten(before);
  const fa = flatten(after);
  const keys = new Set([...Object.keys(fb), ...Object.keys(fa)]);
  for (const k of keys) {
    if (fb[k] === fa[k]) continue;
    if (k.includes('.Suitability.') || k.includes('NegativeMarket.')) return true;
  }
  return false;
}

async function main() {
  const cosmos = {
    account: env('COSMOS_ACCOUNT'),
    database: env('COSMOS_DATABASE', 'KycAnalyzer'),
    key: env('COSMOS_READONLY_KEY'),
  };

  const files = (await readdir(CONFIG_DIR)).filter((f) => f.endsWith('.json'));
  const onDisk = await Promise.all(
    files.map(async (f) => ({
      file: f,
      doc: JSON.parse(await readFile(join(CONFIG_DIR, f), 'utf8')),
    })),
  );

  // Group what's already tracked, by the document's own Regulation field (not the filename),
  // since 13-1's Regulation field is the bare string "13" rather than "13-1".
  const trackedByRegulation = new Map();
  for (const { doc } of onDisk) {
    const reg = String(doc.Regulation);
    const list = trackedByRegulation.get(reg) ?? [];
    list.push(doc);
    trackedByRegulation.set(reg, list);
  }

  const inventory = await cosmosListInventory(cosmos);
  const liveByRegulation = new Map();
  for (const d of inventory) {
    const reg = String(d.Regulation);
    const list = liveByRegulation.get(reg) ?? [];
    list.push(d);
    liveByRegulation.set(reg, list);
  }

  const rows = [];
  const writes = [];

  for (const [reg, docs] of [...trackedByRegulation.entries()].sort()) {
    const diskMax = docs.reduce((a, b) => (b.Version > a.Version ? b : a));
    const liveDocs = (liveByRegulation.get(reg) ?? []).slice().sort((a, b) => a.Version - b.Version);
    if (liveDocs.length === 0) {
      rows.push({ reg, status: 'NOT IN PROD ANYMORE', diskMax: diskMax.id, liveMax: '—' });
      continue;
    }
    const liveMax = liveDocs[liveDocs.length - 1];
    const skipped = liveDocs.filter((d) => d.Version > diskMax.Version && d.Version < liveMax.Version);

    if (liveMax.Version === diskMax.Version && liveMax.id === diskMax.id) {
      // Same id — fetch anyway, because MAS-12 proved content can change with no version bump.
      const live = await cosmosGet(cosmos, liveMax.id);
      if (JSON.stringify(live) === JSON.stringify(diskMax)) {
        rows.push({ reg, status: 'unchanged', diskMax: diskMax.id, liveMax: liveMax.id });
      } else {
        rows.push({
          reg,
          status: '\u26a0\ufe0f IN-PLACE MUTATION (same id, different content)',
          diskMax: diskMax.id,
          liveMax: liveMax.id,
          scoringTouched: touchesScoring(diskMax, live),
        });
        writes.push({ id: liveMax.id, doc: live });
      }
      continue;
    }

    const live = await cosmosGet(cosmos, liveMax.id);
    rows.push({
      reg,
      status: 'new version',
      diskMax: diskMax.id,
      liveMax: liveMax.id,
      skipped: skipped.map((d) => d.id),
      scoringTouched: touchesScoring(diskMax, live),
    });
    writes.push({ id: liveMax.id, doc: live });
  }

  for (const { id, doc } of writes) {
    await writeFile(join(CONFIG_DIR, `${id}.json`), JSON.stringify(doc, null, 2) + '\n');
  }

  const lines = [];
  lines.push('# config-prod weekly refresh');
  lines.push('');
  lines.push(
    `Read directly from the live \`${CONTAINER}\` container (\`${cosmos.account}\`), ` +
      `scoped to the regulations already mirrored under \`config-prod/\`. The \`ClientRiskProfile\` ` +
      'container (customer data) is never queried by this job.',
  );
  lines.push('');
  lines.push('| Regulation | Status | Disk had | Prod has | Scoring/NM touched | Skipped versions |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(
      `| ${r.reg} | ${r.status} | ${r.diskMax} | ${r.liveMax} | ${r.scoringTouched === undefined ? '—' : r.scoringTouched ? 'yes' : 'no'} | ${(r.skipped ?? []).join(', ') || '—'} |`,
    );
  }
  const mutations = rows.filter((r) => r.status.includes('MUTATION'));
  if (mutations.length > 0) {
    lines.push('');
    lines.push('## \u26a0\ufe0f In-place mutations');
    lines.push('');
    lines.push(
      'The following ids kept the same `id`/`Version` but their stored content changed. Any ' +
        'profile already scored under that id cannot be distinguished from one scored after this ' +
        'change — the id is no longer a reliable pointer to "the rules that produced this result". ' +
        'This happened once before, to `MAS-12` (`EtfNegativeMarket` appeared with no version bump), ' +
        'which is why this script checks for it even when the version number says nothing changed.',
    );
    for (const r of mutations) lines.push(`- \`${r.liveMax}\``);
  }
  lines.push('');
  lines.push(
    'This refresh does not touch `build_workbook.py`, `build_nm_workbook.py`, `tech.md`, ' +
      '`nm-formulas.md` or `verification.md` — those mirror these documents by hand and need a ' +
      'reviewer to decide what changed, not a script.',
  );

  const summary = lines.join('\n') + '\n';
  process.stdout.write(summary);
  await writeFile(SUMMARY_PATH, summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
