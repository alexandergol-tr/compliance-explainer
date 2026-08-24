import { describe, expect, it } from 'vitest';
import { CosmosProfileSource } from './cosmos/source';
import { FixtureSource } from './fixtures';
import type { IdentityLookup, IdentitySource } from './identity/types';

/**
 * The identity rows below are real, read from
 * `main.compliance.bronze_userapidb_customer_customeridentification`. They are here because the
 * bug these tests pin down is not hypothetical: `48744807` is simultaneously one person's GCID,
 * a second person's real CID and a third person's demo CID, and all three have a populated
 * `ClientRiskProfile` in different countries with different risk levels.
 */
const ROWS = [
  { gcid: 48744807, realCid: 48740387, demoCid: 49923503 },
  { gcid: 48749227, realCid: 48744807, demoCid: 49927923 },
  { gcid: 47566111, realCid: 47561691, demoCid: 48744807 },
  { gcid: 19603211, realCid: 19314904, demoCid: 20839862 },
];

class StubIdentity implements IdentitySource {
  readonly label = 'stub';
  calls: number[] = [];

  async lookup(id: number): Promise<IdentityLookup> {
    this.calls.push(id);
    return {
      asGcid: ROWS.find((r) => r.gcid === id) ?? null,
      asRealCid: ROWS.find((r) => r.realCid === id) ?? null,
      asDemoCid: ROWS.find((r) => r.demoCid === id) ?? null,
    };
  }
}

/** Fails the test if resolution reaches for a profile; identity questions must not need one. */
function sourceWithIdentity(identity: IdentitySource) {
  const source = new CosmosProfileSource(identity);
  source.getProfile = async () => {
    throw new Error('resolve() must not read the profile store when an identity source exists');
  };
  return source;
}

describe('resolving a real CID', () => {
  it('lands on the CID owner, not the identically-numbered GCID', async () => {
    const source = sourceWithIdentity(new StubIdentity());
    const result = await source.resolve(48744807, 'cid');

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    // The whole point. Before the fix this returned 48744807 — a different customer.
    expect(result.user.gcid).toBe(48749227);
    expect(result.user.cid).toBe(48744807);
    expect(result.via).toBe('cid');
  });

  it('reports the other spaces the number occupies', async () => {
    const source = sourceWithIdentity(new StubIdentity());
    const result = await source.resolve(48744807, 'cid');

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.alsoValidAs).toEqual(['gcid', 'demo-cid']);
  });
});

describe('resolving a GCID', () => {
  it('does not translate, and fills in the real CID from the map', async () => {
    const source = sourceWithIdentity(new StubIdentity());
    const result = await source.resolve(48744807, 'gcid');

    expect(result.kind).toBe('resolved');
    if (result.kind !== 'resolved') return;
    expect(result.user.gcid).toBe(48744807);
    expect(result.user.cid).toBe(48740387);
    expect(result.via).toBe('gcid');
  });

  it('says the number is a real CID instead when it is not a GCID', async () => {
    const source = sourceWithIdentity(new StubIdentity());
    const result = await source.resolve(48740387, 'gcid');

    expect(result.kind).toBe('not-found');
    if (result.kind !== 'not-found') return;
    expect(result.tried).toBe('gcid');
    expect(result.alsoValidAs).toEqual(['cid']);
  });
});

describe('demo CIDs', () => {
  it('are identified rather than reported as missing customers', async () => {
    const source = sourceWithIdentity(new StubIdentity());
    // 49923503 is only ever a demo CID in the map.
    const result = await source.resolve(49923503, 'cid');
    expect(result.kind).toBe('demo-cid');
  });

  it('never leak the owning GCID', async () => {
    const source = sourceWithIdentity(new StubIdentity());
    const result = await source.resolve(49923503, 'cid');
    expect(JSON.stringify(result)).not.toContain('48744807');
  });
});

describe('a number in no space at all', () => {
  it('is not found, with nothing else to suggest', async () => {
    const source = sourceWithIdentity(new StubIdentity());
    const result = await source.resolve(999_999_999, 'cid');

    expect(result.kind).toBe('not-found');
    if (result.kind !== 'not-found') return;
    expect(result.alsoValidAs).toEqual([]);
  });
});

describe('without an identity source', () => {
  it('refuses a CID rather than trying it as a GCID', async () => {
    const source = new CosmosProfileSource(null);
    let readProfile = false;
    source.getProfile = async () => {
      readProfile = true;
      return null;
    };

    const result = await source.resolve(48744807, 'cid');
    expect(result.kind).toBe('unavailable');
    // The regression itself: the old code fell through to a GCID read here.
    expect(readProfile).toBe(false);
  });

  it('still resolves a GCID from profile existence', async () => {
    const source = new CosmosProfileSource(null);
    source.getProfile = async () => ({ gcid: 19603211 });

    const result = await source.resolve(19603211, 'gcid');
    expect(result.kind).toBe('resolved');
  });
});

describe('the fixture source', () => {
  it('does not cross id spaces either', async () => {
    const fixtures = new FixtureSource();
    const examples = await fixtures.list();
    const gcid = examples[0].gcid;

    // A known fixture GCID must not resolve when the operator says it is a CID.
    const asCid = await fixtures.resolve(gcid, 'cid');
    expect(asCid.kind).toBe('not-found');
    if (asCid.kind !== 'not-found') return;
    expect(asCid.alsoValidAs).toEqual(['gcid']);

    const asGcid = await fixtures.resolve(gcid, 'gcid');
    expect(asGcid.kind).toBe('resolved');
  });
});
