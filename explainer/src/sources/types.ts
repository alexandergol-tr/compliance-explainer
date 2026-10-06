/**
 * Where a profile comes from.
 *
 * The abstraction exists because the app must be buildable and demonstrable before any
 * access question is settled. Fixtures work today with no credentials; the KYCAnalyzer
 * source slots in behind the same interface once a route and a grant exist; a SQL source
 * can join later for history. None of that touches the renderer.
 */

import type { RawNode } from '@/domain/tree';

/** As it arrives from the service or Cosmos. Every field optional — that is the honest shape. */
export interface RawProfile {
  gcid: number;
  regulation?: number | string | null;
  countryId?: number | null;
  verificationLevel?: number | null;
  configurationVersion?: number | null;
  recalculationReason?: number | null;
  createdOn?: string | null;
  updatedOn?: string | null;
  lastAnswerOccurredAt?: string | null;
  suitability?: RawSuitability | null;
  questionsAnswers?: RawQuestionAnswers[] | null;
  productNegativeMarkets?: RawProductNegativeMarkets | null;
  productAppropriateness?: Record<string, unknown> | null;
}

export type BlockResultName = 'Blocked' | 'NotBlocked' | 'Warning' | string;

export interface RawNmRuleAttempt {
  attemptsTaken?: number;
  lastAttemptOccurredAt?: string | null;
  nextAttemptStartDate?: string | null;
  question?: string | null;
}

export interface RawNmRuleResult {
  rule?: string | null;
  result?: BlockResultName | null;
  checkResult?: BlockResultName | null;
  attempts?: RawNmRuleAttempt[] | null;
}

export interface RawNmProductResult {
  result?: BlockResultName | null;
  assessmentExpired?: boolean | null;
  coolingOffPeriodEndDate?: string | null;
  recalculatedOn?: string | null;
  recalculationReason?: number | string | null;
  configurationVersion?: number | null;
  revolvingDoorQuestions?: (number | string)[] | null;
  ruleResults?: RawNmRuleResult[] | null;
  isAllQuestionsAnswered?: boolean | null;
}

/** Keys are product short names: `Cfd`, `Futures`, `Etf`, … */
export type RawProductNegativeMarkets = Record<string, RawNmProductResult | undefined>;

export interface RawSuitability {
  suitabilityBlock?: number | string | null;
  clientRiskLevel?: number | string | null;
  revolvingDoorQuestions?: (number | string)[] | null;
  ongoingMonitoring?: RawOngoingMonitoring | null;
  suitabilityCalculationDetails?: RawNode[] | null;
  isAllQuestionsAnswered?: boolean | null;
}

export interface RawOngoingMonitoring {
  ftdDate?: string | null;
  financialSustainability?: number | null;
  copyUtilization?: number | null;
  manuallyUnblocked?: boolean | null;
  /** Computed on the service; recomputed here rather than trusted, since it is derivable. */
  blockedByOngoingMonitoring?: boolean | null;
}

/** `QuestionAnswers(int QuestionId, IReadOnlyList<int> AnswerIds)` — a list, for multi-select. */
export interface RawQuestionAnswers {
  questionId: number;
  answerIds: number[];
}

/**
 * Which identifier space a number was read from.
 *
 * Demo CIDs are deliberately not a kind. They are a real space — `Customer.CustomerIdentification`
 * carries `DemoCID` alongside `GCID` and `CID` — but nobody investigating a suitability cap is
 * holding one, and admitting a third readable space would add collision surface for no gain.
 * They are still *detected*, so a demo CID gets an explanation rather than a bare "not found".
 */
export type IdKind = 'gcid' | 'cid';

export interface ResolvedUser {
  gcid: number;
  cid: number | null;
  username: string | null;
}

/**
 * The other spaces a number is also valid in.
 *
 * This is not decoration. Measured over the 48.87M rows of the identity map, 99.0% of GCIDs are
 * simultaneously some other person's real CID and 96.1% are some other person's demo CID, so a
 * number carries no evidence of which space it came from. Reading `48744807` as a GCID, as a
 * real CID and as a demo CID yields three different live customers in three different countries
 * with three different risk levels.
 *
 * Only the *space* is reported, never the owning GCID. The point is to let an operator notice
 * they picked the wrong type, not to hand out the mapping for a space we decline to resolve.
 */
export type OtherSpace = 'gcid' | 'cid' | 'demo-cid';

/**
 * Resolution can fail in ways that matter to the user, so the result is a union rather than
 * a nullable. "No such GCID", "that is a demo CID" and "that number is a real CID, you picked
 * the wrong type" all arrive as an empty upstream response and need different things said.
 */
export type Resolution =
  | { kind: 'resolved'; user: ResolvedUser; via: IdKind; alsoValidAs: OtherSpace[] }
  | { kind: 'not-found'; id: number; tried: IdKind; alsoValidAs: OtherSpace[] }
  | { kind: 'demo-cid'; id: number }
  | { kind: 'unavailable'; reason: string };

/**
 * What a source can actually supply.
 *
 * This exists because one of them cannot supply the two things the app is for. The
 * KYCAnalyzer REST API returns no calculation tree and no answers — `SuitabilityResultDto`
 * has no `SuitabilityCalculationDetails` property and `ClientRiskProfileResultDto` has no
 * `QuestionsAnswers` property, so neither is in the service's contract at all.
 *
 * Without this flag, a source that returns a profile with `suitability.
 * suitabilityCalculationDetails` absent is indistinguishable from a user who genuinely has
 * no calculation, and the UI would confidently report the wrong reason. Declaring the
 * capability lets the page say "this source cannot provide it" instead.
 */
export interface SourceCapabilities {
  /** Can return `suitabilityCalculationDetails`. */
  tree: boolean;
  /** Can return `questionsAnswers`. */
  answers: boolean;
}

export interface ProfileSource {
  /** Stable key, e.g. `fixtures`. */
  readonly id: string;
  /** Shown in the UI so it is always obvious whether data is real. */
  readonly label: string;
  readonly isRealData: boolean;
  readonly capabilities: SourceCapabilities;

  /**
   * `kind` is required, with no "work it out" option. See `OtherSpace`: the spaces overlap
   * almost completely, so inferring the kind from the number is guessing, and guessing wrong
   * puts a different customer's financial data on screen with no signal that it happened.
   */
  resolve(id: number, kind: IdKind): Promise<Resolution>;
  getProfile(gcid: number): Promise<RawProfile | null>;
  /** For the fixture picker; real sources return an empty list. */
  list(): Promise<{ gcid: number; description: string }[]>;
}

/** Thrown when a source is selected but not configured, so the UI can say what is missing. */
export class SourceNotConfigured extends Error {
  constructor(
    readonly sourceId: string,
    readonly missing: string[],
  ) {
    super(
      `Source "${sourceId}" is not configured. Missing: ${missing.join(', ')}.`,
    );
    this.name = 'SourceNotConfigured';
  }
}
