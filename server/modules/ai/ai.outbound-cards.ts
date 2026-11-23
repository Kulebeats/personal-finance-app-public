/**
 * Card detection for outbound redaction (R17 #246).
 *
 * Works on the MATCHING COPY built by ai.outbound-redaction: every decimal
 * digit is ASCII there, every dash is "-" and every whitespace run is one
 * space. Spans are copy offsets.
 *
 * - A digit run is maximal: digits joined by any mix of the card joiners
 *   (space . - / , _ : U+00B7 U+2022; NFKC has already folded U+FF0F to "/").
 *   A comma (with or without spaces after it) joins only after a group of 4+
 *   digits (coordinator ruling after r7): a thousands separator always
 *   follows a 1-3 digit group, so "1,234.50, 2,000.00" and "K1,500,000.00"
 *   stay apart, while "4111, 1111, 1111, 1111", "3782,822463,10005" and a
 *   19-digit "5061,4604,1012,0223,210" (short last group) still join.
 * - Inside a run, every 13-19 digit window is tested against the issuer
 *   ranges and Luhn (Astra r6). Which windows are tried (coordinator ruling,
 *   Fable r8 F10):
 *   - a window inside one contiguous digit group may start and end anywhere,
 *     so a card fused to a CVV, an expiry or other digits is found;
 *   - a window over several groups starts on a group's first digit and ends
 *     on a group's last digit, so a list of amounts only fuses whole amounts.
 *     It may end inside its last group only to leave a glued CVV or expiry:
 *     3-5 digits taken, 2-4 left ("4111 1111 1111 1111123");
 *   - a window reaches into a calendar date (ai.outbound-dates) only from the
 *     left and only through its year: "card 4539 1488 0347 2025/01/28" keeps
 *     the card (its last group reads as a year, then an expiry), while
 *     "4500.00 2026-01-16" and "01/05/2026 - 28/05/2026" never fuse.
 *
 * Known limit (coordinator, Fable r8): a list of four 4-digit amounts is one
 * 16-digit window, so about one list in ten passes issuer + Luhn and is
 * masked. That is the safe side.
 *
 * @module ai/ai.outbound-cards
 */
import { CARD_JOINERS, joinerClass } from "./ai.outbound-joiners";
import { findDateSpans, type DateSpan } from "./ai.outbound-dates";

export const CARD_MIN_DIGITS = 13;
export const CARD_MAX_DIGITS = 19;

/**
 * Issuer (IIN) prefixes (Fable r7 F2): Visa 4; Mastercard, Maestro, Verve and
 * Dankort 50-59; Discover, UnionPay and Maestro 60-69; Mir 2200-2204;
 * Mastercard 2221-2720; Amex 34/37; Diners 300-305, 309, 36, 38, 39; JCB
 * 3528-3589; UnionPay 81/82. JCB 2131/1800 and UATP 1 are left out on purpose:
 * they collide with year lists. A year (1900-2100) is never an issuer prefix,
 * so a date cannot hide the start of a card.
 */
const CARD_ISSUER =
  /^(?:4|5[0-9]|6[0-9]|220[0-4]|222[1-9]|22[3-9][0-9]|2[3-6][0-9][0-9]|27[01][0-9]|2720|3[47]|30[0-59]|3[689]|352[89]|35[3-8][0-9]|81|82)/;

/** Card joiners in the copy (Fable r7 F4); issuer + Luhn still gate every window. */
const JOINER = joinerClass(CARD_JOINERS);
const DIGIT_RUN = new RegExp(`(?<!\\d${JOINER}*)\\d(?:${JOINER}*\\d)*`, "g");

/** Fills a non-joining comma; never a digit or a joiner, so it ends a run. */
const BREAK = "\u0001";
/** A comma after this many digits joins a run (a thousands group has 1-3). */
const COMMA_JOIN_MIN_DIGITS = 4;
const COMMA_AFTER_DIGITS = /(\d+),/g;

/** A card's last group (3-5 digits) with a glued CVV or expiry (2-4 digits). */
const GLUED_TAKEN_MIN = 3;
const GLUED_TAKEN_MAX = 5;
const GLUED_LEFT_MIN = 2;
const GLUED_LEFT_MAX = 4;

export function isLuhnValid(digits: string): boolean {
  let sum = 0;
  for (let offset = 0; offset < digits.length; offset += 1) {
    const digit = digits.charCodeAt(digits.length - 1 - offset) - 48;
    const weighted = offset % 2 === 1 ? digit * 2 : digit;
    sum += weighted > 9 ? weighted - 9 : weighted;
  }
  return sum % 10 === 0;
}

export function isCardNumber(digits: string): boolean {
  return (
    digits.length >= CARD_MIN_DIGITS &&
    digits.length <= CARD_MAX_DIGITS &&
    CARD_ISSUER.test(digits) &&
    isLuhnValid(digits)
  );
}

function mergeOverlapping(spans: ReadonlyArray<readonly [number, number]>): Array<readonly [number, number]> {
  const ordered = [...spans].sort((left, right) => left[0] - right[0]);
  return ordered.reduce<Array<readonly [number, number]>>((merged, span) => {
    const previous = merged[merged.length - 1];
    if (previous && span[0] < previous[1]) {
      return [...merged.slice(0, -1), [previous[0], Math.max(previous[1], span[1])] as const];
    }
    return [...merged, span];
  }, []);
}

/** A run's digits: copy offset, digit group, and each group's first digit and size. */
interface RunShape {
  positions: number[];
  digits: string;
  groupOf: number[];
  groupFirst: number[];
  groupSize: number[];
}

function shapeOf(run: string, runStart: number): RunShape {
  const groups = [...run.matchAll(/\d+/g)];
  const groupFirst = groups.reduce<number[]>(
    (firsts, group, index) => [...firsts, index === 0 ? 0 : firsts[index - 1] + groups[index - 1][0].length],
    [],
  );
  return {
    positions: groups.flatMap((group) => [...group[0]].map((_, offset) => runStart + group.index + offset)),
    digits: groups.map((group) => group[0]).join(""),
    groupOf: groups.flatMap((group, index) => [...group[0]].map(() => index)),
    groupFirst,
    groupSize: groups.map((group) => group[0].length),
  };
}

/** Group rule: one contiguous group anywhere; over groups, whole groups (or a glued tail left). */
function onGroupBoundaries(shape: RunShape, first: number, last: number): boolean {
  const startGroup = shape.groupOf[first];
  const endGroup = shape.groupOf[last];
  if (startGroup === endGroup) return true;
  if (first !== shape.groupFirst[startGroup]) return false;
  const taken = last - shape.groupFirst[endGroup] + 1;
  const left = shape.groupSize[endGroup] - taken;
  if (left === 0) return true;
  return taken >= GLUED_TAKEN_MIN && taken <= GLUED_TAKEN_MAX && left >= GLUED_LEFT_MIN && left <= GLUED_LEFT_MAX;
}

/** Date rule: never start inside a date; enter one only from the left and only through its year. */
function respectsDates(dates: readonly DateSpan[], start: number, lastDigit: number): boolean {
  return dates.every((date) => {
    if (start >= date.end || lastDigit < date.start) return true;
    if (start >= date.start) return false;
    return date.yearStart === date.start && lastDigit < date.yearEnd;
  });
}

function cardSpansInRun(run: string, runStart: number, dates: readonly DateSpan[]): Array<readonly [number, number]> {
  const shape = shapeOf(run, runStart);
  const near = dates.filter((date) => date.end > runStart && date.start < runStart + run.length);
  const hits: Array<readonly [number, number]> = [];
  for (let first = 0; first + CARD_MIN_DIGITS <= shape.digits.length; first += 1) {
    const longest = Math.min(CARD_MAX_DIGITS, shape.digits.length - first);
    for (let length = CARD_MIN_DIGITS; length <= longest; length += 1) {
      const last = first + length - 1;
      if (!onGroupBoundaries(shape, first, last)) continue;
      if (!respectsDates(near, shape.positions[first], shape.positions[last])) continue;
      if (isCardNumber(shape.digits.slice(first, first + length))) {
        hits.push([shape.positions[first], shape.positions[last] + 1]);
      }
    }
  }
  return mergeOverlapping(hits);
}

/** A comma that follows fewer than 4 digits becomes a break. */
function breakShortGroupCommas(text: string): string {
  return text.replace(COMMA_AFTER_DIGITS, (match, digits: string) =>
    digits.length >= COMMA_JOIN_MIN_DIGITS ? match : digits + BREAK,
  );
}

/** Card spans in a matching copy. */
export function findCardSpans(text: string): Array<readonly [number, number]> {
  const prepared = breakShortGroupCommas(text);
  const dates = findDateSpans(prepared);
  return [...prepared.matchAll(DIGIT_RUN)].flatMap((run) => cardSpansInRun(run[0], run.index, dates));
}
