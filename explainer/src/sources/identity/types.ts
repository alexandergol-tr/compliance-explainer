/**
 * Identity resolution, kept separate from profile reading.
 *
 * These are two different questions — "who is this number?" and "what did the engine decide
 * about them?" — answered by two different systems, and conflating them is what produced the
 * bug this module exists to fix. `ClientRiskProfile` documents are keyed by GCID and carry no
 * CID of any kind, so the profile store *cannot* answer the first question. When resolution was
 * folded into the profile source, the only thing it could do with a CID was try it as a GCID,
 * which succeeds ~99% of the time against the wrong person.
 */

/** One row of the identity map. `GCID`, `CID` (real) and `DemoCID` for one human. */
export interface IdentityRecord {
  gcid: number;
  realCid: number;
  demoCid: number | null;
}

/**
 * One number, looked up in all three spaces at once.
 *
 * All three, not just the one asked for, because the overlap is the whole problem: knowing that
 * a number is also a valid real CID is what lets the UI say "you may have picked the wrong id
 * type" instead of "no user found". One round trip answers it.
 */
export interface IdentityLookup {
  asGcid: IdentityRecord | null;
  asRealCid: IdentityRecord | null;
  asDemoCid: IdentityRecord | null;
}

export interface IdentitySource {
  /** Shown in provenance so it is always clear which system answered. */
  readonly label: string;
  lookup(id: number): Promise<IdentityLookup>;
}

export class IdentityNotConfigured extends Error {
  constructor(readonly missing: string[]) {
    super(`Identity source is not configured. Missing: ${missing.join(', ')}.`);
    this.name = 'IdentityNotConfigured';
  }
}

export class IdentityLookupError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Identity lookup failed: ${detail}`);
    this.name = 'IdentityLookupError';
  }
}
