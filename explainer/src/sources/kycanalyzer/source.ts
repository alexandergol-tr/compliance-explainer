/**
 * The KYCAnalyzer REST API — kept, but it cannot be this app's primary source.
 *
 * `GET api/v1/kycanalyzer/clientRiskProfile/{gcid}` returns neither the calculation tree nor
 * the user's answers. This is not AutoMapper flattening a polymorphic tree, which is what the
 * handoff pack recorded as the open risk; the fields are simply not in the contract:
 *
 *   - `SuitabilityResultDto` declares `SuitabilityBlock`, `ClientRiskLevel`,
 *     `RevolvingDoorQuestions`, `OngoingMonitoring` and `IsAllQuestionsAnswered` — and no
 *     `SuitabilityCalculationDetails`.
 *   - `ClientRiskProfileResultDto` declares no `QuestionsAnswers` and no
 *     `LastAnswerOccurredAt`.
 *   - Neither name appears on any DTO anywhere in `kycanalyzer-nuget`.
 *
 * `[code]` kycanalyzer-nuget/eToro.KYCAnalyzerService.Dto/ClientRiskProfile/Result/.
 *
 * So this source is still worth having — it is the cheapest way to read the *headline* result
 * through a supported contract, and it is the right thing to reconcile against — but the tree
 * and the answers have to come from Cosmos or from SQL. It declares that in `capabilities`
 * rather than returning a profile whose missing tree looks like a user with no calculation.
 */

import type { IdKind, ProfileSource, RawProfile, Resolution, SourceCapabilities } from '../types';
import { get, requireClientConfig } from './read-only-client';

/**
 * The service returns PascalCase or camelCase depending on serializer settings, and the
 * domain models mix conventions per endpoint. Rather than assume, lowercase the first letter
 * of every key on the way in so the domain layer sees one convention.
 *
 * This is the single explicit translation boundary. Doing it here keeps every other module
 * honest about the shape it works with.
 */
function toCamel<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => toCamel(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key.charAt(0).toLowerCase() + key.slice(1)] = toCamel(v);
    }
    return out as T;
  }
  return value as T;
}

export class KycAnalyzerSource implements ProfileSource {
  readonly id = 'kycanalyzer';
  readonly label = 'KYCAnalyzer API — headline result only (real customer data)';
  readonly isRealData = true;
  readonly capabilities: SourceCapabilities = { tree: false, answers: false };

  async getProfile(gcid: number): Promise<RawProfile | null> {
    const config = requireClientConfig(this.id);
    const raw = await get<unknown>(`api/v1/kycanalyzer/clientRiskProfile/${gcid}`, config);
    return raw === null ? null : toCamel<RawProfile>(raw);
  }

  /**
   * GCID only, and deliberately not faked for CIDs.
   *
   * CID -> GCID belongs to UserApi's `GetBasicInfoByCidAsync`, whose DTO reads its `Cid` from the
   * JSON property `RealCid` and has no `DemoCid` — so even wired up, that route could not tell a
   * demo CID from a nonexistent one. The identity source this app uses instead reads all three
   * columns, but it is attached to the Cosmos source, which is the only one that can supply the
   * tree and the answers anyway.
   */
  async resolve(id: number, kind: IdKind): Promise<Resolution> {
    if (kind === 'gcid') {
      const profile = await this.getProfile(id);
      return profile
        ? { kind: 'resolved', user: { gcid: id, cid: null, username: null }, via: 'gcid', alsoValidAs: [] }
        : { kind: 'not-found', id, tried: 'gcid', alsoValidAs: [] };
    }
    return {
      kind: 'unavailable',
      reason:
        'CID lookup needs an identity service; the profile store holds no CID. Enter a GCID, ' +
        'or select the fixture source.',
    };
  }

  async list() {
    // Never enumerate real users.
    return [];
  }
}
