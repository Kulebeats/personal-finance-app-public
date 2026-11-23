/**
 * R17 review fix P1-1: outbound redaction (CLAUDE.md Rule 4.4, "no PII").
 *
 * Tool results are sanitised elsewhere; this covers what the USER typed, in
 * the current message and in every replayed prior turn, before any provider
 * adapter sees it. Identifying tokens become typed placeholders so the
 * question still reads naturally ("my email is [email]"). Ordinary amounts,
 * dates and periods are left alone. This is a best-effort filter for common
 * identifiers, not a promise that free text carries no personal information
 * (the consent disclosure says so).
 *
 * Structure (Astra r4, coordinator design; Fable r7):
 * 1. The text is NFKC-normalised and every format character (\p{Cf}) plus
 *    U+034F and the variation selectors U+FE00-FE0F is removed, as is any
 *    combining mark (\p{M}, the supplementary selectors U+E0100-E01EF among
 *    them) right after a digit (Fable r8 F13); that form is what is sent.
 * 2. Rules match a separate MATCHING COPY in which every Unicode dash (\p{Pd},
 *    U+2212) is "-", every whitespace run (newlines included) is one space and
 *    every decimal digit (\p{Nd}, any script) is its ASCII digit. Each copy
 *    unit maps back to its source span, so placeholders are spliced into the
 *    sent text at the right offsets.
 *
 * Rules (Fable r8 F9: what is redacted is the UNION of what the rules find,
 * so no rule can hide text from another). The id rule runs first and masks
 * its spans; then card, email, nrc and phone run twice, once in this order
 * with each rule masking its claims (so neither email nor NRC can claim a
 * card's last group, Fable r7 F7) and once each on the copy as it stands
 * after the id rule (so a false card window cannot leave the rest of a phone
 * number or NRC unmatched). Overlapping spans merge into one placeholder.
 * - id, a UUID;
 * - card (ai.outbound-cards): a 13-19 digit window of a joined digit run that
 *   passes the issuer ranges and Luhn;
 * - email, in any script, with spaces tolerated around "@" and dots; masked
 *   characters are outside its classes;
 * - nrc, 6-2-1 digits (spaces allowed inside the 6 and 2 groups) joined by
 *   any of space . - /, not right after a currency code or symbol when the
 *   first separator is "." (an amount such as "ZMW 123456.78 - 9");
 * - phone, a Zambian number with a +260, 260, 00260 or 0 prefix, or a bare
 *   contiguous / "97 123 4567" mobile, with separators or brackets anywhere;
 *   other international numbers need "+" and no decimal point. Only numeric
 *   context before it (a digit, or a digit then "." or ",") blocks a phone.
 *   Calendar dates are masked first, so "02-12-2026 15:30" is never read as
 *   a landline (Fable r8 F11).
 *
 * Known limits:
 * - each text is redacted on its own, so an identifier the user deliberately
 *   splits across turns is not reassembled (coordinator call);
 * - a card deliberately written as dates is not found (coordinator ruling);
 * - a list of whole digit groups that passes issuer + Luhn is redacted as a
 *   card: about one list of four 4-digit amounts in ten (coordinator ruling).
 *
 * Scope (coordinator, Astra r2): a member's own free-text mention of their own
 * account, merchant or goal names is household data they chose to type and is
 * not redacted here; tool results go through the sanitiser.
 *
 * @module ai/ai.outbound-redaction
 */
import type { ProviderPriorTurn } from "./ai.provider.types";
import { findCardSpans } from "./ai.outbound-cards";
import { maskDates } from "./ai.outbound-dates";
import { joinerClass, MARKS_IN_DIGIT_RUN, PHONE_JOINERS } from "./ai.outbound-joiners";

export { isCardNumber, isLuhnValid } from "./ai.outbound-cards";

export type RedactionKind = "email" | "id" | "nrc" | "card" | "phone";
export type RedactionCounts = Record<RedactionKind, number>;

/** Format characters, the combining grapheme joiner and variation selectors (Fable r7 F5). */
const INVISIBLE_CHARACTERS = /[\p{Cf}͏︀-️]/gu;
const DASH = /[\p{Pd}−]/u;
const WHITESPACE = /\s/u;
const DECIMAL_DIGIT = /\p{Nd}/u;
/** Fills a claimed span in the matching copy; no later rule matches it. */
const MASK = "\u0000";

const PLACEHOLDER: Record<RedactionKind, string> = {
  email: "[email]",
  id: "[id]",
  nrc: "[nrc]",
  card: "[card]",
  phone: "[phone]",
};

const NRC_SEP = "[ /.-]+";
const NRC_SIX = String.raw`(?<!\d)\d(?: ?\d){5}`;
/**
 * Right after a currency code or symbol, a "." first separator is an amount
 * (Astra r5: "ZMW 123456.78 - 9 transactions"); "/" never is (Fable r7 F8:
 * "Banda K 123456/78/1").
 */
const NOT_AFTER_CURRENCY = String.raw`(?<!(?:\b(?:ZMW|ZMK|USD|EUR|GBP|ZAR|K)|[$€£]) ?)`;
const NRC_PATTERN = new RegExp(
  String.raw`(?:${NOT_AFTER_CURRENCY}${NRC_SIX}(?= *\.)|${NRC_SIX}(?! *\.))${NRC_SEP}\d ?\d${NRC_SEP}\d(?!\d)`,
  "gi",
);

/** Phone separators in the copy, i.e. space, dot, dash and brackets. */
const PS = `${joinerClass(PHONE_JOINERS)}*`;
/**
 * A bare 9-digit mobile is blocked only by a digit, or by a digit and a
 * decimal point. A comma never blocks it (Fable r9 F14): a thousands group is
 * exactly 3 digits, so a 9-digit run touching a comma ("K500,971234567",
 * "Banda,971234567,500") is never part of an amount.
 */
const PHONE_START = String.raw`(?<!\d|\d\.)`;
const PHONE_END = String.raw`(?!\d|\.\d)`;
/**
 * Mobile 95-98, 75-77, 55-57 and landline 21 (Fable r7 F3). 098 (Zed Mobile)
 * and 055/056/057 are not yet checked against the ZICTA numbering plan;
 * over-redacting a number is the safe side.
 */
const ZM_LEAD = String.raw`(?:9${PS}[5-8]|7${PS}[5-7]|5${PS}[5-7]|2${PS}1)`;
const ZM_NUMBER = String.raw`${ZM_LEAD}(?:${PS}\d){7}`;
/** +260, 260 and 00260 (as WhatsApp links and mobile-money receipts write it), or a trunk 0. */
const ZM_COUNTRY = String.raw`2${PS}6${PS}0`;
/** "+260", "00260" or a trunk 0: never how an amount is grouped. */
const ZM_MARKED_PREFIX = String.raw`(?:\+${PS}${ZM_COUNTRY}|0${PS}0${PS}${ZM_COUNTRY}|(?:\(${PS})?0)`;
/** Bare mobiles take the same operator codes as ZM_LEAD (Fable r8 F12). */
const ZM_BARE = String.raw`(?:(?:9[5-8]|7[5-7]|5[5-7]|21)\d{7}|(?:9[5-8]|7[5-7]|5[5-7])[ .-]\d{3}[ .-]\d{4})`;
/** International: "+" then 8-15 digits; a decimal point is never a separator. */
const INTERNATIONAL = String.raw`\+[ ()-]*\d(?:[ ()-]*\d){7,14}`;
/**
 * A Zambian number with a "+260", "00260", "260" or trunk-0 prefix (10 to 14
 * digits) is blocked only by a digit next to it. Neither a comma nor a dot
 * makes it part of an amount: no thousands group or decimal part is that
 * long, so "0970000001,0950000002" (Fable r8 F9), "John Banda,260971234567,500.00"
 * (r9 F14) and "0971234567.0961234567" (r9 F16) are all phones.
 */
const ZM_START = String.raw`(?<!\d)`;
const ZM_END = String.raw`(?!\d)`;
/** An international "+" number keeps the decimal guard ("+12345678.90" is an amount). */
const MARKED_START = String.raw`(?<!\d|\d\.)`;
const MARKED_END = String.raw`(?!\d|\.\d)`;
const PHONE_PATTERN = new RegExp(
  `${ZM_START}(?:${ZM_MARKED_PREFIX}${PS}${ZM_NUMBER}|${ZM_COUNTRY}${PS}${ZM_NUMBER})${ZM_END}` +
    `|${MARKED_START}${INTERNATIONAL}${MARKED_END}` +
    `|${PHONE_START}${ZM_BARE}${PHONE_END}`,
  "g",
);

type SpanFinder = (text: string) => ReadonlyArray<readonly [number, number]>;

function regexFinder(pattern: RegExp): SpanFinder {
  return (text) => [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length] as const);
}

const RULES: ReadonlyArray<{ kind: RedactionKind; find: SpanFinder }> = [
  { kind: "id", find: regexFinder(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi) },
  { kind: "card", find: findCardSpans },
  // Any script (u flag): <non-space>+ @ <label>(.<label>)* . <letters>; never a masked unit.
  {
    kind: "email",
    find: regexFinder(/[^\s@\0]+\s*@\s*[^\s@.\0]+(?:\s*\.\s*[^\s@.\0]+)*\s*\.\s*\p{L}{2,}/gu),
  },
  { kind: "nrc", find: regexFinder(NRC_PATTERN) },
  { kind: "phone", find: (text) => regexFinder(PHONE_PATTERN)(maskDates(text)) },
];

/** NFKC + invisible-character removal; the form that is sent. */
export function normaliseOutboundText(text: string): string {
  return text.normalize("NFKC").replace(INVISIBLE_CHARACTERS, "").replace(MARKS_IN_DIGIT_RUN, "");
}

interface MatchingCopy {
  text: string;
  /** Source offset where copy unit i starts / ends (exclusive). */
  starts: readonly number[];
  ends: readonly number[];
}

const digitValues = new Map<number, string>();

/**
 * The ASCII digit for any \p{Nd} character (Fable r7 F6). Decimal digits
 * always come in contiguous 0-9 sets, so the value is the distance from the
 * start of the contiguous \p{Nd} block, modulo 10.
 */
function asciiDigit(point: number): string {
  if (point >= 0x30 && point <= 0x39) return String.fromCharCode(point);
  const cached = digitValues.get(point);
  if (cached !== undefined) return cached;
  let zero = point;
  while (DECIMAL_DIGIT.test(String.fromCodePoint(zero - 1))) zero -= 1;
  const value = String((point - zero) % 10);
  digitValues.set(point, value);
  return value;
}

/**
 * Dashes become "-", whitespace runs one space, decimal digits ASCII; offsets
 * map back to source. Read by code point (Astra r6), so a supplementary-plane
 * dash or digit is one copy unit. Any other supplementary character keeps its
 * two UTF-16 units, one copy unit each, so copy offsets stay aligned.
 */
export function buildMatchingCopy(source: string): MatchingCopy {
  const units: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const push = (unit: string, start: number, end: number) => {
    units.push(unit);
    starts.push(start);
    ends.push(end);
  };
  let index = 0;
  while (index < source.length) {
    const start = index;
    const point = source.codePointAt(index) ?? 0;
    const char = String.fromCodePoint(point);
    if (WHITESPACE.test(char)) {
      while (index < source.length && WHITESPACE.test(source[index])) index += 1;
      push(" ", start, index);
      continue;
    }
    index += char.length;
    if (DASH.test(char)) push("-", start, index);
    else if (DECIMAL_DIGIT.test(char)) push(asciiDigit(point), start, index);
    else for (let unit = 0; unit < char.length; unit += 1) push(char[unit], start + unit, start + unit + 1);
  }
  return { text: units.join(""), starts, ends };
}

interface Span {
  start: number;
  end: number;
  kind: RedactionKind;
}

function maskSpans(text: string, spans: readonly Span[]): string {
  return spans.reduce(
    (masked, span) => masked.slice(0, span.start) + MASK.repeat(span.end - span.start) + masked.slice(span.end),
    text,
  );
}

function spansOf(rule: (typeof RULES)[number], text: string): Span[] {
  return rule.find(text).map(([start, end]) => ({ start, end, kind: rule.kind }));
}

/** Overlapping spans become one; the earliest (then longest) span names it. */
function mergeSpans(spans: readonly Span[]): Span[] {
  const ordered = [...spans].sort((left, right) => left.start - right.start || right.end - left.end);
  return ordered.reduce<Span[]>((merged, span) => {
    const previous = merged[merged.length - 1];
    if (previous && span.start < previous.end) {
      return [...merged.slice(0, -1), { ...previous, end: Math.max(previous.end, span.end) }];
    }
    return [...merged, span];
  }, []);
}

/** The union of the sequential (masking) pass and each rule run on its own (Fable r8 F9). */
function collectSpans(matchText: string): Span[] {
  const [idRule, ...rules] = RULES;
  const ids = spansOf(idRule, matchText);
  const base = maskSpans(matchText, ids);
  const sequential = rules.reduce<{ text: string; spans: Span[] }>(
    (state, rule) => {
      const found = spansOf(rule, state.text);
      return { text: maskSpans(state.text, found), spans: [...state.spans, ...found] };
    },
    { text: base, spans: [] },
  ).spans;
  const independent = rules.flatMap((rule) => spansOf(rule, base));
  return mergeSpans([...ids, ...sequential, ...independent]);
}

function spliceSpans(source: string, copy: MatchingCopy, spans: readonly Span[]): string {
  const ordered = [...spans].sort((left, right) => left.start - right.start);
  const pieces: string[] = [];
  let cursor = 0;
  for (const span of ordered) {
    pieces.push(source.slice(cursor, copy.starts[span.start]), PLACEHOLDER[span.kind]);
    cursor = copy.ends[span.end - 1];
  }
  pieces.push(source.slice(cursor));
  return pieces.join("");
}

function emptyCounts(): RedactionCounts {
  return { email: 0, id: 0, nrc: 0, card: 0, phone: 0 };
}

export function redactOutboundText(text: string): { text: string; counts: RedactionCounts } {
  const source = normaliseOutboundText(text);
  const copy = buildMatchingCopy(source);
  const spans = collectSpans(copy.text);
  const counts = spans.reduce((total, span) => ({ ...total, [span.kind]: total[span.kind] + 1 }), emptyCounts());
  return { text: spliceSpans(source, copy, spans), counts };
}

export interface OutboundRedaction {
  message: string;
  priorTurns: ProviderPriorTurn[];
  counts: RedactionCounts;
  redacted: boolean;
}

function addCounts(left: RedactionCounts, right: RedactionCounts): RedactionCounts {
  return {
    email: left.email + right.email,
    id: left.id + right.id,
    nrc: left.nrc + right.nrc,
    card: left.card + right.card,
    phone: left.phone + right.phone,
  };
}

/** Redact the current message and every prior turn; counts are totals. */
export function redactOutbound(message: string, priorTurns: readonly ProviderPriorTurn[]): OutboundRedaction {
  const current = redactOutboundText(message);
  const turns = priorTurns.map((turn) => ({ turn, result: redactOutboundText(turn.text) }));
  const counts = turns.reduce((total, { result }) => addCounts(total, result.counts), current.counts);
  return {
    message: current.text,
    priorTurns: turns.map(({ turn, result }) => ({ ...turn, text: result.text })),
    counts,
    redacted: Object.values(counts).some((count) => count > 0),
  };
}

/** Audit form: only the kinds that were actually redacted. */
export function redactionAuditCounts(counts: RedactionCounts): Partial<RedactionCounts> {
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0)) as Partial<RedactionCounts>;
}
