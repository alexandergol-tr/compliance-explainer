/**
 * What the customer answered, and how that answer became the level on the leaf.
 *
 * The tree the engine stores names each question and the level it scored, but not the answer that
 * produced it. That is the first thing anyone asks — "they picked Investments/Savings, why is this
 * Low?" — and until now the app could only show the level.
 *
 * The engine has two distinct routes from answers to a question's level, and conflating them would
 * produce confident nonsense on Component 8. From `SuitabilityRiskLevelCalculator`:
 *
 *   1. **No answer stored, or an empty answer list** — the level is the component's
 *      `DefaultRiskLevel`, falling back to the document's. The customer's answer never enters it.
 *   2. **Weighted** (`WeigthAnswers` non-empty *and* at least one of its statements selected) —
 *      total the statement scores and band the total. Only Component 8 does this.
 *   3. **Per-answer** — map each selected answer to its configured level, defaulting any the
 *      configuration does not list, then combine with the *component's* operation.
 *
 * Route 2 wins over route 3 when it applies, which is how one document carries both the current
 * and legacy Component 8 answer sets: a user who answered with the legacy ids selects none of the
 * weighted statements, the group yields nothing, and the engine falls through to route 3.
 *
 * ## Weighted scoring credits what you did *not* select
 *
 * `GetScoreByAnswerIds` adds a statement's score when selected and *subtracts it when not*. Every
 * statement therefore contributes to every total, which has a consequence worth stating plainly:
 * a statement retired from the funnel but left in the configuration can never be selected, so it
 * contributes its negated score to every user forever. Component 8's `NewerCfdTrs` — the OTC
 * complex products statement, id 212 — is in exactly that state, and this module flags it.
 */

import type { ConfigQuestion, Operation, RiskLevelString } from '@/config/types';
import { answerText, isOfferedToCustomers, type AnswerText } from './copy';
import { riskLevelDisplay, type RiskLevelName } from './ids';
import { KycAnswerIds } from './generated/kyc-enums';
import { compute, type Scale } from './scale';

export interface SelectedAnswer {
  answerId: number;
  copy: AnswerText;
  /** The level the configuration gives this answer, or null when it does not list it. */
  configuredLevel: RiskLevelName | null;
  /** True when the configuration has no entry, so the engine used the default. */
  usedDefault: boolean;
}

export interface WeightedStatement {
  answerId: number | null;
  /** The configuration's enum name for the statement. Always present; ids may not resolve. */
  identifier: string;
  copy: AnswerText;
  /** The configured credit for judging this statement correctly. */
  score: number;
  selected: boolean;
  /** `+score` when selected, `-score` when not. Always applied. */
  contribution: number;
  /** False when the funnel no longer offers it, so it can only ever contribute unselected. */
  offered: boolean;
}

export interface WeightedScoring {
  statements: WeightedStatement[];
  total: number;
  /** The band the total fell into, or the default when no band matched. */
  band: RiskLevelName | null;
  bandFloor: number | null;
  /** Statements the configuration scores but the funnel no longer offers. */
  retired: WeightedStatement[];
}

export type LeafRoute =
  /** No answer on record; the level is a configured default. */
  | 'default'
  /** Component 8's weighted quiz. */
  | 'weighted'
  /** Selected answers mapped to levels and combined. */
  | 'per-answer'
  /** The question is not in the configuration on screen, so nothing can be said. */
  | 'not-in-config';

export interface LeafExplanation {
  route: LeafRoute;
  /** Empty on the `default` route. */
  selected: SelectedAnswer[];
  weighted: WeightedScoring | null;
  /** How multiple selected answers were combined. The component's operation. */
  operation: Operation | null;
  /** The default that applied here, whether or not it was used. */
  defaultLevel: RiskLevelName | null;
  computed: RiskLevelName | null;
  stored: RiskLevelName | null;
  /** False only when both levels are known and differ. */
  agrees: boolean;
  summary: string;
  /** Things a reader should not have to infer, e.g. a retired-but-scored statement. */
  notes: string[];
}

function toRiskLevelName(value: RiskLevelString | null | undefined): RiskLevelName | null {
  return (value ?? null) as RiskLevelName | null;
}

function noun(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** Answer ids on the profile are numbers; the configuration names them. */
function idFor(identifier: string): number | null {
  const id = KycAnswerIds[identifier];
  return id === undefined ? null : id;
}

function scoreWeighted(
  question: ConfigQuestion,
  questionId: number | null,
  answerIds: number[],
  defaultLevel: RiskLevelName | null,
): WeightedScoring | null {
  const groups = question.WeigthAnswers ?? [];
  if (groups.length === 0) return null;

  // The engine iterates groups and skips any where the user selected none of the statements. No
  // live configuration has more than one group, so the first that yields a level is the answer;
  // modelling more would invent a combining rule the engine does not have here.
  for (const group of groups) {
    const configured = group.Answers ?? [];
    if (configured.length === 0) continue;

    // `GetScore` switches to the answer-verity routine when every statement declares `IsCorrect`.
    // Nothing live does, and that path needs per-answer verity and free text the profile does not
    // carry, so it is deliberately not modelled — better to show nothing than to show a total
    // computed by the wrong routine.
    if (configured.every((statement) => statement.IsCorrect !== undefined && statement.IsCorrect !== null)) {
      return null;
    }

    const selectedAny = configured.some((statement) => {
      const id = idFor(statement.Answer);
      return id !== null && answerIds.includes(id);
    });
    if (!selectedAny) continue;

    const statements: WeightedStatement[] = configured.map((statement) => {
      const id = idFor(statement.Answer);
      const selected = id !== null && answerIds.includes(id);
      return {
        answerId: id,
        identifier: statement.Answer,
        copy: answerText(questionId, id),
        score: statement.Score,
        selected,
        contribution: selected ? statement.Score : -statement.Score,
        offered: isOfferedToCustomers(questionId, id),
      };
    });

    const total = statements.reduce((sum, statement) => sum + statement.contribution, 0);
    const band = [...(group.QuestionScoreToRiskLevelMappings ?? [])]
      .sort((a, b) => b.MinTotalScore - a.MinTotalScore)
      .find((mapping) => mapping.MinTotalScore <= total);

    return {
      statements,
      total,
      band: band ? toRiskLevelName(band.RiskLevel) : defaultLevel,
      bandFloor: band?.MinTotalScore ?? null,
      retired: statements.filter((statement) => !statement.offered),
    };
  }

  return null;
}

export interface LeafContext {
  question: ConfigQuestion;
  /** The component's operation — questions are combined with it, not with one of their own. */
  operation: Operation;
  rounding: 'Down' | 'Up' | null;
  /** `component.DefaultRiskLevel ?? riskLevel.DefaultRiskLevel`. */
  defaultLevel: RiskLevelName | null;
  documentScale: Scale;
}

export function explainLeaf(
  context: LeafContext | null,
  questionId: number | null,
  answerIds: number[] | null,
  stored: RiskLevelName | null,
): LeafExplanation {
  const base = {
    selected: [] as SelectedAnswer[],
    weighted: null,
    operation: context?.operation ?? null,
    defaultLevel: context?.defaultLevel ?? null,
    stored,
    notes: [] as string[],
  };

  if (!context) {
    return {
      ...base,
      route: 'not-in-config',
      computed: null,
      agrees: true,
      summary: 'This question is not in the configuration shown, so its answer cannot be scored here.',
    };
  }

  const { question, operation, rounding, defaultLevel, documentScale } = context;
  const ids = answerIds ?? [];

  if (ids.length === 0) {
    return {
      ...base,
      route: 'default',
      computed: defaultLevel,
      agrees: defaultLevel === null || stored === null || defaultLevel === stored,
      summary: `No answer on record, so this scored the configured default, ${riskLevelDisplay(defaultLevel)}.`,
    };
  }

  const weighted = scoreWeighted(question, questionId, ids, defaultLevel);

  if (weighted) {
    // The band is the single level handed to the component's operation, so the operation over one
    // element is the band itself. Stating the operation here would imply a combination that the
    // engine does not perform.
    const notes: string[] = [];
    for (const statement of weighted.retired) {
      notes.push(
        `"${statement.copy.text}" is still scored by this configuration but is ` +
          `no longer offered in the funnel, so nobody can select it. It contributes ` +
          `${statement.contribution > 0 ? '+' : ''}${statement.contribution} to every user's total.`,
      );
    }

    // Count only the statements the customer could actually see. A retired statement always scores
    // positively because it can only ever be left unselected, so including it would credit the
    // customer with a judgment they were never offered the chance to make.
    const judged = weighted.statements.filter((statement) => statement.offered);
    const right = judged.filter((statement) => statement.contribution > 0).length;
    const retiredContribution = weighted.retired.reduce(
      (sum, statement) => sum + statement.contribution,
      0,
    );
    return {
      ...base,
      route: 'weighted',
      weighted,
      computed: weighted.band,
      agrees: weighted.band === null || stored === null || weighted.band === stored,
      summary:
        `${right} of ${judged.length} statements judged correctly, for a total of ${weighted.total}` +
        (retiredContribution !== 0
          ? ` (which includes ${retiredContribution > 0 ? '+' : ''}${retiredContribution} from ` +
            `${noun(weighted.retired.length, 'statement')} nobody can answer)`
          : '') +
        (weighted.bandFloor !== null
          ? `, which falls in the ${riskLevelDisplay(weighted.band)} band (${weighted.bandFloor} and above).`
          : `, which matched no band, so the default ${riskLevelDisplay(weighted.band)} applied.`),
      notes,
    };
  }

  // Keyed by id, not by name. The engine compares `(KycAnswer)customerAnswerId == x.Answer`, which
  // is an id comparison, and going the other way is ambiguous: ten ids are aliased and for some the
  // first-declared name is obsolete, so an id resolved back to a name can be a spelling the
  // configuration never uses. Converting the configuration's names to ids matches what the engine
  // does and is unambiguous.
  const byId = new Map<number, RiskLevelName | null>();
  for (const answer of question.Answers ?? []) {
    const id = KycAnswerIds[answer.Answer];
    if (id !== undefined && !byId.has(id)) byId.set(id, toRiskLevelName(answer.RiskLevel));
  }

  const selected: SelectedAnswer[] = ids.map((answerId) => {
    const configured = byId.get(answerId);
    return {
      answerId,
      copy: answerText(questionId, answerId),
      configuredLevel: configured ?? null,
      usedDefault: !byId.has(answerId),
    };
  });

  const levels = selected.map((answer) => answer.configuredLevel ?? defaultLevel);
  const known = levels.filter((level): level is RiskLevelName => level !== null);
  const computed = known.length === levels.length
    ? (compute(operation, rounding, known, documentScale, null)?.level ?? null)
    : null;

  const notes: string[] = [];
  const gaps = selected.filter((answer) => answer.usedDefault);
  if (gaps.length > 0) {
    notes.push(
      `${gaps.length === 1 ? 'This answer is' : 'These answers are'} not listed by this ` +
        `configuration for this question, so ${gaps.length === 1 ? 'it' : 'they'} scored the ` +
        `default ${riskLevelDisplay(defaultLevel)} with nothing raised anywhere: ` +
        `${gaps.map((answer) => answer.copy.text).join(', ')}.`,
    );
  }

  // "scores X" is only true when the configuration actually lists the answer. Saying it of an
  // answer that fell through to the default reads as a deliberate rating and hides the gap, which
  // is the opposite of what someone looking at an unscored answer needs to know.
  const summary = selected.length === 1
    ? selected[0].usedDefault
      ? `Answered "${selected[0].copy.text}", which this configuration does not score.`
      : `Answered "${selected[0].copy.text}", which this configuration scores ${riskLevelDisplay(levels[0])}.`
    : `${selected.length} answers selected — ${selected
        .map(
          (answer, index) =>
            `"${answer.copy.text}" ${answer.usedDefault ? 'unscored' : riskLevelDisplay(levels[index])}`,
        )
        .join(', ')} — combined with the component's ${operation}.`;

  return {
    ...base,
    route: 'per-answer',
    selected,
    computed,
    agrees: computed === null || stored === null || computed === stored,
    summary,
    notes,
  };
}
