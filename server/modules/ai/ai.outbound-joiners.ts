/**
 * R17 #246: the separators the outbound scanners accept between digits, in
 * one place, so the card scanner, the phone patterns and the combining-mark
 * strip cannot drift apart (Codex on 6b3123fd3: a mark after "•" survived the
 * strip and split a card's digit run in two).
 *
 * @module ai/ai.outbound-joiners
 */

/** What the card scanner accepts between digits, in the matching copy. */
export const CARD_JOINERS: readonly string[] = [" ", ".", "-", "/", ",", "_", ":", "·", "•"];

/** What the Zambian phone patterns accept between digits, in the matching copy. */
export const PHONE_JOINERS: readonly string[] = [" ", ".", "(", ")", "-"];

/** A regex character class of `joiners`, escaped for both plain and `u` patterns. */
export function joinerClass(joiners: readonly string[]): string {
  return `[${joiners.map((joiner) => joiner.replace(/[\\\]\[^-]/g, "\\$&")).join("")}]`;
}

/**
 * Raw-text forms the matching copy folds into the joiners above. Every
 * whitespace character becomes " ", every dash (and U+2212) becomes "-".
 */
const FOLDED_JOINERS = String.raw`\s\p{Pd}−`;

/**
 * Every scanner's joiners, plus "+": it prefixes an international number
 * after a list separator ("0977123456,+260971234567"), so a mark after it is
 * stripped too. "+" joins no scanner's digit groups.
 */
const MARK_STRIP_JOINERS = [...new Set([...CARD_JOINERS, ...PHONE_JOINERS, "+"])];

/**
 * Combining marks inside a digit run (Fable r8 F13, r9 F17): after a digit, or
 * after a run of joiners (and marks) that follows one, e.g. "4111́1111"
 * or "4111 •́1111". Built from every scanner's joiners.
 */
export const MARKS_IN_DIGIT_RUN = new RegExp(
  String.raw`(?<=\p{Nd}[${FOLDED_JOINERS}${joinerClass(MARK_STRIP_JOINERS).slice(1, -1)}\p{M}]*)\p{M}+`,
  "gu",
);
