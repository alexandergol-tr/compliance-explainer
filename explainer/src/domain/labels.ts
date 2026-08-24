/**
 * Turning numeric ids into something a human can read.
 *
 * The whole point of this app is explanation, so the one hard rule is that nothing
 * renders as a bare number. Resolution degrades in steps and always terminates in
 * something readable:
 *
 *   1. the customer-facing text, once a static-data integration exists  (not yet wired)
 *   2. the code identifier from the C# enum, humanised                  (works today)
 *   3. "Question 15" / "Answer 46"                                      (last resort)
 *
 * Step 1 is gate G4 in the handoff. Until it closes, step 2 is what ships — readable
 * to an engineer, honest about what it is, and never a bare id.
 */

import { KycAnswerAliases, KycAnswerNames, KycQuestionNames } from './generated/kyc-enums';

export type LabelSource = 'static-data' | 'enum' | 'fallback';

export interface Label {
  /** What to show. */
  text: string;
  /** Where it came from, so the UI can be honest about fidelity. */
  source: LabelSource;
  /** The code identifier, when known — useful next to the text for engineers. */
  identifier?: string;
  /**
   * Other enum members sharing this id. Ten answer ids are aliased in the C# enum, so
   * the id -> name direction is genuinely ambiguous for those and picking one silently
   * would be a small lie. The label shows the first-declared name and discloses the rest.
   */
  aliases?: readonly string[];
}

/**
 * `MiCARiskLosingInvestments` -> `MiCA risk losing investments`.
 *
 * Two things make this more than a regex one-liner. Acronyms have to survive, so runs of
 * capitals stay together (`MiCA`, `Cfd` is already mixed-case in the enum). And these
 * identifiers are full of money bands — `Between200KAnd500K`, `UpTo10K` — where a naive split
 * on the capital/digit boundary produces `Between200 K And500 K`, which reads as broken. So the
 * magnitude suffixes get rejoined to their number afterwards.
 */

/**
 * Words the enums spell in mixed case but that should read as acronyms. Mapped to their
 * canonical form so `LeveragedCfd` becomes `Leveraged CFD` rather than `Leveraged cfd`.
 */
const ACRONYMS: Readonly<Record<string, string>> = {
  CFD: 'CFD',
  CFDS: 'CFDs',
  ETF: 'ETF',
  ETFS: 'ETFs',
  OTC: 'OTC',
  TRS: 'TRS',
  KYC: 'KYC',
  FX: 'FX',
  US: 'US',
  UK: 'UK',
  ID: 'ID',
  PR: 'PR',
};

export function humanise(identifier: string): string {
  // Every boundary rule uses a lookahead rather than a capture group. With `/g` and captures,
  // one match consumes the character the next boundary needs, so `FewWeeksUpToSeveral` came out
  // as `Few Weeks UpTo Several` — the `p` was eaten by the `sUp` match. Lookaheads consume
  // nothing, so adjacent boundaries all fire.
  const words = identifier
    // End of an acronym run, before a new word: `MiCARisk` -> `MiCA Risk`
    .replace(/([A-Z]+)(?=[A-Z][a-z])/g, '$1 ')
    // lower or digit before the start of a word: `riskLosing` -> `risk Losing`.
    // Requiring a trailing lowercase is what stops this splitting inside `MiCA`.
    .replace(/([a-z\d])(?=[A-Z][a-z])/g, '$1 ')
    // letter before a digit: `Between200K` -> `Between 200K`. The magnitude suffix stays
    // attached because no rule above splits `0K`.
    .replace(/([A-Za-z])(?=\d)/g, '$1 ')
    .split(/\s+/)
    .filter(Boolean);

  return words
    .map((word, index) => {
      const acronym = ACRONYMS[word.toUpperCase()];
      if (acronym) return acronym;
      // `MiCA` and friends: more than one capital means it is deliberate, so leave it alone.
      if ((word.match(/[A-Z]/g)?.length ?? 0) > 1) return word;
      // `10K`, `200K`, `20` — a digit means the casing is significant.
      if (/\d/.test(word)) return word;
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase();
    })
    .join(' ');
}

export function questionLabel(questionId: number | null | undefined): Label {
  if (questionId === null || questionId === undefined) {
    return { text: 'Unknown question', source: 'fallback' };
  }
  const identifier = KycQuestionNames[questionId];
  if (!identifier) {
    return { text: `Question ${questionId}`, source: 'fallback' };
  }
  return { text: humanise(identifier), source: 'enum', identifier };
}

export function answerLabel(answerId: number | null | undefined): Label {
  if (answerId === null || answerId === undefined) {
    return { text: 'Unknown answer', source: 'fallback' };
  }
  const identifier = KycAnswerNames[answerId];
  if (!identifier) {
    return { text: `Answer ${answerId}`, source: 'fallback' };
  }
  return {
    text: humanise(identifier),
    source: 'enum',
    identifier,
    aliases: KycAnswerAliases[answerId],
  };
}

/**
 * Configuration documents refer to questions and answers by enum *name*, not by id,
 * so config-driven views need no lookup — only humanising.
 */
export function labelFromIdentifier(identifier: string): Label {
  return { text: humanise(identifier), source: 'enum', identifier };
}

/**
 * Component names in the configuration are bare numbers ("1".."9"). On their own they
 * are meaningless on screen, and the mapping is stable across every config in
 * production (tech.md §4.2), so it is safe to name them here.
 */
export const COMPONENT_TITLES: Readonly<Record<string, string>> = {
  '1': 'Experience frequency',
  '2': 'Experience volume',
  '3': 'Trading knowledge',
  '4': 'Trading strategy',
  '5': 'Purpose of trading',
  '6': 'Risk appetite',
  '7': 'Source of income',
  '8': 'Knowledge assessment',
  '9': 'MiCA crypto assessment',
};

export function componentTitle(name: string | null | undefined): string {
  if (!name) return 'Component';
  return COMPONENT_TITLES[name] ? `Component ${name} — ${COMPONENT_TITLES[name]}` : `Component ${name}`;
}
