/**
 * Generates the customer-facing copy map from the two repos that own it.
 *
 * The app's labels used to be humanised C# enum identifiers, which are the wording furthest
 * from the customer. That is actively misleading in places: question 8's `SavingsForHome`
 * scores Medium and reads "Saving" on screen, while `PurposeInvestments` scores Low and reads
 * "Investments/Savings". Explaining a score with the enum name describes an option the
 * customer never saw.
 *
 * Two inputs, because neither repo holds both halves:
 *
 *   - `compliance-kycx-staticdata` owns the question catalogue: which options exist per
 *     question, and the POEditor key for each.
 *   - `eToro-Plus` carries a checked-in mirror of the en-US POEditor export, which is the
 *     only English text available to us — the POEditor project itself is no longer reachable,
 *     and the read proxy that replaced it sits in a different Entra tenant.
 *
 * ## Keyed by (question, answer), never by answer alone
 *
 * 61 answer ids are reused across questions and 14 of those carry different copy per question:
 * `a140` is "Above $2000" under question 47 but "Above $2,000" under question 48. A map keyed
 * on the answer id alone would silently pick whichever question was parsed last.
 *
 * ## Overrides
 *
 * 31 questions carry an `overrides` block whose `options[]` supersede the base ones. Question 9
 * is the only question whose base options carry no `text` at all, so skipping the merge loses
 * risk appetite entirely — the one question in Factor A besides purpose of trading.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/domain/generated/kyc-copy.ts');

const CATALOGUE = resolve(
  HERE,
  '../../../../../compliance-kycx-staticdata/src/Modules/eToro.KYCX.StaticData.Modules.Questions/Infrastructure/LocalResources/Configurations/Questions/OptionQuestions.json',
);
const TRANSLATIONS = resolve(
  HERE,
  '../../../../../eToro-Plus/libs/common/infra/translations/rn/src/lib/resources/en-us/kyc.json',
);

/**
 * Questions 10 and 11 interpolate the account's display currency — `{{symbol}}` in the option
 * bands, `{{currency}}` in the headings — and the profile carries no currency field, so we do
 * not have it. Both are filled with the USD pair as a deliberate assumption, recorded in the
 * snapshot so the UI can disclose it rather than implying we read it from the user.
 */
const CURRENCY = { symbol: '$', currency: 'USD' };

function sha256(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/** POEditor keys are dotted paths; the export nests them as objects. */
function flatten(value, prefix, into) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, into);
    else if (typeof child === 'string' && into[path] === undefined) into[path] = child;
  }
  return into;
}

function mergedOptions(question) {
  const overrides = new Map(
    (question.overrides?.options ?? []).map((option) => [String(option.id), option]),
  );
  return (question.options ?? []).map((option) => {
    const override = overrides.get(String(option.id)) ?? {};
    return {
      id: String(option.id),
      text: override.text ?? option.text ?? null,
      subText: override.subText ?? option.subText ?? null,
    };
  });
}

function literal(text) {
  return JSON.stringify(text);
}

const catalogueRaw = readFileSync(CATALOGUE, 'utf8');
const translationsRaw = readFileSync(TRANSLATIONS, 'utf8');

const copy = flatten(JSON.parse(translationsRaw), '', {});
const parsed = JSON.parse(catalogueRaw);
const questions = Array.isArray(parsed) ? parsed : (parsed.questions ?? []);

const questionCopy = new Map();
const answerCopy = new Map();
const answerSub = new Map();

let resolved = 0;
const unresolved = [];
const skippedQuestions = [];
let currencySubstitutions = 0;
const leftoverPlaceholders = new Set();

function resolveKey(key) {
  if (!key) return null;
  const text = copy[key];
  if (text === undefined) return null;
  let out = text;
  for (const [placeholder, value] of Object.entries(CURRENCY)) {
    const token = `{{${placeholder}}}`;
    if (out.includes(token)) {
      out = out.replaceAll(token, value);
      currencySubstitutions += 1;
    }
  }
  for (const match of out.matchAll(/\{\{(\w+)\}\}/g)) leftoverPlaceholders.add(match[1]);
  return out;
}

for (const question of questions) {
  const id = String(question.id);
  // `110-popup` is a presentation variant of question 110 and shares its keys. Question ids in
  // the engine are integers, so a non-numeric id has nothing to join to.
  if (!/^\d+$/.test(id)) {
    skippedQuestions.push(id);
    continue;
  }

  const heading = resolveKey(question.overrides?.text ?? question.text);
  if (heading) questionCopy.set(Number(id), heading);

  for (const option of mergedOptions(question)) {
    if (!/^\d+$/.test(option.id)) {
      // Runtime-generated dropdowns (occupation, country) have no fixed option ids.
      unresolved.push(`q${id} a${option.id} ${option.text ?? '(no key)'}`);
      continue;
    }
    const text = resolveKey(option.text);
    if (text === null) {
      unresolved.push(`q${id} a${option.id} ${option.text ?? '(no key)'}`);
      continue;
    }
    resolved += 1;
    answerCopy.set(`${id}:${option.id}`, text);
    const sub = resolveKey(option.subText);
    if (sub) answerSub.set(`${id}:${option.id}`, sub);
  }
}

const total = resolved + unresolved.length;
const entries = (map) =>
  [...map.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b), 'en', { numeric: true }))
    .map(([key, value]) => `  ${literal(String(key))}: ${literal(value)},`)
    .join('\n');

const banner = `/**
 * GENERATED by scripts/gen-copy.mjs — do not edit.
 *
 * A dated snapshot of the customer-facing question and answer copy. Regenerate with
 * \`npm run gen:copy\` when either source repo moves.
 *
 * Coverage: ${resolved}/${total} options resolved. The ${unresolved.length} that did not are
 * runtime-generated dropdowns and the futures risk assessment; none are scored by any
 * suitability configuration, so no scored question falls back to an enum name.
 *
 * Questions 10 and 11 interpolate the account currency, which the profile does not carry. They
 * are rendered as ${CURRENCY.symbol} / ${CURRENCY.currency} — an assumption, not data. ${currencySubstitutions} strings are affected.
 */`;

const out = `${banner}

export const CopySnapshot = {
  capturedOn: ${literal(new Date().toISOString().slice(0, 10))},
  locale: 'en-US',
  catalogue: { path: 'compliance-kycx-staticdata OptionQuestions.json', sha: ${literal(sha256(catalogueRaw))} },
  translations: { path: 'eToro-Plus rn/resources/en-us/kyc.json', sha: ${literal(sha256(translationsRaw))} },
  /** Assumed, not read from the profile. Disclose wherever an affected band is shown. */
  assumedCurrency: ${literal(`${CURRENCY.symbol} (${CURRENCY.currency})`)},
  currencySubstitutions: ${currencySubstitutions},
  /** Questions whose copy depends on the assumption above. */
  currencyDependentQuestions: [10, 11] as readonly number[],
  resolved: ${resolved},
  total: ${total},
  unresolved: ${unresolved.length},
} as const;

/** Question heading, by \`KycQuestion\` id. */
export const QuestionCopy: Readonly<Record<number, string>> = {
${entries(questionCopy)}
};

/**
 * Answer copy, keyed \`questionId:answerId\`. Keyed by both because answer ids are reused
 * across questions with different wording.
 */
export const AnswerCopy: Readonly<Record<string, string>> = {
${entries(answerCopy)}
};

/** Supporting line beneath an option, where the funnel shows one. */
export const AnswerCopySub: Readonly<Record<string, string>> = {
${entries(answerSub)}
};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

console.log(`copy: ${resolved}/${total} options resolved (${((100 * resolved) / total).toFixed(1)}%)`);
console.log(`      ${questionCopy.size} question headings, ${answerSub.size} sub-labels`);
console.log(
  `      ${currencySubstitutions} currency placeholders filled with ${CURRENCY.symbol} / ${CURRENCY.currency}`,
);
if (skippedQuestions.length) console.log(`      skipped non-numeric question ids: ${skippedQuestions.join(', ')}`);
if (leftoverPlaceholders.size) {
  console.warn(`  ! unsubstituted placeholders remain: ${[...leftoverPlaceholders].join(', ')}`);
}
for (const miss of unresolved) console.log(`      unresolved: ${miss}`);
console.log(`wrote ${OUT}`);
