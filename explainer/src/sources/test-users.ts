/**
 * Hand-curated real GCIDs used for manual / regression checks against production.
 *
 * Not synthetic fixtures — these resolve through Cosmos when configured. Keep the row
 * thin: gcid, regulation, country only. No answers, no tree, no PII beyond the identifier
 * itself. Add a row when you find a profile that exercises an awkward state; do not dump
 * cohorts here.
 *
 * Country is the numeric `CountryId` from the profile (eToro Country enum), not a display
 * name — the enum lives in KYCAnalyzer and is not vendored into this app yet.
 */

export interface TestUser {
  gcid: number;
  regulation: string;
  /** eToro `Country` enum id, as stored on `ClientRiskProfile.CountryId`. */
  country: number;
}

/**
 * Filled from live Cosmos reads on 2026-08-24. Extend by appending; do not reorder without
 * a reason — the home-page list follows this order.
 */
export const TEST_USERS: readonly TestUser[] = [
  { gcid: 48773298, regulation: 'CySEC', country: 57 },
  { gcid: 47598601, regulation: 'CySEC', country: 57 },
  { gcid: 49336783, regulation: 'ASICGAML', country: 12 },
];
