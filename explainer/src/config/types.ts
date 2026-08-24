/**
 * Wire types for `ClientRiskProfileConfiguration` documents.
 *
 * Modelled to match the documents verbatim, including the spellings the engine actually
 * ships — `WeigthAnswers` is misspelled in production and is left misspelled here. A
 * "corrected" field name would simply never bind.
 *
 * Only the suitability slice is typed. Each document also carries several negative-market
 * blocks and per-country overrides that this app does not read.
 */

export type RiskLevelString = 'Minimal' | 'Low' | 'Medium' | 'MediumHigh' | 'High';
export type Operation = 'Min' | 'Max' | 'Avg' | 'Sum';

/**
 * `Round` is `Up = 1, Down = 2`, so the `0` that appears on every non-averaging factor is not
 * a member at all — it is `default(Round)` surviving serialisation. The engine only ever tests
 * `round == Round.Down`, so 0 falls through to the round-up branch; harmless where it occurs
 * because those nodes are `Min`, but it means 0 must not be read as "down".
 */
export type Rounding = 'Down' | 'Up' | 0 | 1 | 2 | null;

export interface AnswerScore {
  Answer: string;
  RiskLevel: RiskLevelString;
}

/**
 * One statement in a weighted quiz. `Score` is the credit for judging it correctly, and the
 * engine applies it in *both* directions — see `WeightedAnswerGroup`.
 */
export interface WeightedAnswer {
  Answer: string;
  Score: number;
  /**
   * Present only on the answer-verity variant, which scores against per-answer true/false
   * plus free text rather than against which ids were selected. No live suitability config
   * uses it; `GetScore` switches on all statements having it.
   */
  IsCorrect?: boolean | null;
  AnswerValue?: string | null;
}

export interface ScoreToRiskLevel {
  RiskLevel: RiskLevelString;
  MinTotalScore: number;
}

/**
 * A weighted quiz: total the statement scores, then band the total.
 *
 * The banding is `OrderByDescending(MinTotalScore).FirstOrDefault(x => x.MinTotalScore <= score)`,
 * so the mappings are lower bounds and the highest satisfied one wins.
 */
export interface WeightedAnswerGroup {
  Answers: WeightedAnswer[] | null;
  QuestionScoreToRiskLevelMappings: ScoreToRiskLevel[] | null;
  QuestionScoreToBlockResultMappings: { BlockResult: string; MinTotalScore: number }[] | null;
}

export interface ConfigQuestion {
  Question: string;
  IsRequiredForCopy: boolean;
  Answers: AnswerScore[] | null;
  /**
   * Misspelled in production; left misspelled so it binds. An array of *groups*, each holding
   * its own statements and banding — not a flat list of answers. Component 8 is the only user
   * of it, with exactly one group.
   *
   * When a question has both this and `Answers`, the weighted path wins, but only if the user
   * selected at least one statement in the group. Otherwise `Calculate` returns an empty array
   * and the engine falls back to `Answers`. That is how the legacy and current Component 8
   * answer sets coexist in one document.
   */
  WeigthAnswers: WeightedAnswerGroup[] | null;
}

export interface ConfigComponent {
  Name: string;
  Operation: Operation;
  Round?: Rounding;
  DefaultRiskLevel?: RiskLevelString | null;
  QuestionAnswers: ConfigQuestion[] | null;
  /**
   * A component may carry its own weight scale, and Component 9 is the only one that does
   * (100..500 against the document-level 0..4). It changes the arithmetic: averaging uses
   * this scale and truncates to the nearest 100, where the document scale truncates to an
   * integer. `Min` and `Max` ignore it and use the document scale regardless.
   */
  RiskLevelWeight: RiskLevelWeight[] | null;
}

export interface ConfigFactor {
  Name: string;
  Operation: Operation;
  Round: Rounding;
  Components: ConfigComponent[] | null;
  RevolvingDoorOrder: number;
}

export interface RiskLevelWeight {
  RiskLevel: RiskLevelString;
  Weight: number;
}

export interface QuestionAnswerCheck {
  Question: string;
  Answers: string[] | null;
  IsRequired?: boolean;
  Condition?: string;
}

export interface BlockCheck {
  Condition: string;
  Priority: number;
  Result: string;
  DefaultResult: string;
  QuestionAnswerChecks: QuestionAnswerCheck[] | null;
  NestedChecks: BlockCheck[] | null;
  MinCount: number;
  IsAlternative: boolean;
}

export interface SuitabilityConfig {
  RiskLevel: {
    Operation: Operation;
    Round?: Rounding;
    DefaultRiskLevel: RiskLevelString;
    Factors: ConfigFactor[] | null;
  } | null;
  SuitabilityBlock: {
    Checks: BlockCheck[] | null;
    DefaultResult: string;
  } | null;
  RiskLevelToScoreMappings: { RiskLevel: RiskLevelString; AuthorizedRiskScore: number }[] | null;
  RiskLevelWeight: RiskLevelWeight[] | null;
}

export interface ConfigDocument {
  id: string;
  Regulation: string;
  Version: number;
  UpdatedOn?: string;
  Suitability: SuitabilityConfig | null;
}

/** What the app actually needs, once a document has been read. */
export interface LoadedConfig {
  id: string;
  regulation: string;
  version: number;
  updatedOn: string | null;
  /** False when `Suitability.RiskLevel.Factors` is absent or empty — e.g. MAS from v3. */
  scoresSuitability: boolean;
  defaultRiskLevel: RiskLevelString | null;
  rootOperation: Operation | null;
  rootRounding: Rounding;
  /** The document-level scale, 0..4 in every config seen. Factors, the root and `Min`/`Max` use it. */
  riskLevelWeight: RiskLevelWeight[];
  factors: ConfigFactor[];
  /** `RiskLevel` -> `AuthorizedRiskScore`, from this document rather than a constant. */
  scoreMappings: Record<string, number>;
  blockChecks: BlockCheck[];
  blockDefaultResult: string | null;
}
