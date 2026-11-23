/**
 * Calendar dates in an outbound-redaction matching copy (R17 #246 Fable r8).
 *
 * Works on the matching copy (ASCII digits, every dash "-"). A date is a real
 * calendar date with a year from 1900 to 2100 and one separator throughout:
 * - year first, YYYY-MM-DD or YYYY/MM/DD;
 * - day first, DD/MM/YYYY, DD-MM-YYYY or DD.MM.YYYY.
 * Card windows may reach into a date only through its year from the left
 * (ai.outbound-cards), and the phone rule never reads a date as a number.
 *
 * @module ai/ai.outbound-dates
 */

export interface DateSpan {
  start: number;
  end: number;
  /** Copy offsets of the year digits [yearStart, yearEnd). */
  yearStart: number;
  yearEnd: number;
}

const DATE_YEAR_MIN = 1900;
const DATE_YEAR_MAX = 2100;
const YEAR_FIRST = /(?<!\d)(\d{4})([-/])(\d{2})\2(\d{2})(?!\d)/g;
const DAY_FIRST = /(?<!\d)(\d{2})([-/.])(\d{2})\2(\d{4})(?!\d)/g;
const YEAR_DIGITS = 4;
/** Fills a masked date: never a digit, so no number rule reads it. */
const DATE_FILL = "\u0001";

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (year < DATE_YEAR_MIN || year > DATE_YEAR_MAX || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function findDateSpans(text: string): DateSpan[] {
  const yearFirst = [...text.matchAll(YEAR_FIRST)].flatMap((match) => {
    const [token, year, , month, day] = match;
    if (!isCalendarDate(Number(year), Number(month), Number(day))) return [];
    return [{ start: match.index, end: match.index + token.length, yearStart: match.index, yearEnd: match.index + YEAR_DIGITS }];
  });
  const dayFirst = [...text.matchAll(DAY_FIRST)].flatMap((match) => {
    const [token, day, , month, year] = match;
    if (!isCalendarDate(Number(year), Number(month), Number(day))) return [];
    const end = match.index + token.length;
    return [{ start: match.index, end, yearStart: end - YEAR_DIGITS, yearEnd: end }];
  });
  return [...yearFirst, ...dayFirst];
}

/** The copy with every calendar date filled, so a number rule cannot read one (Fable r8 F11). */
export function maskDates(text: string): string {
  return findDateSpans(text).reduce(
    (masked, span) => masked.slice(0, span.start) + DATE_FILL.repeat(span.end - span.start) + masked.slice(span.end),
    text,
  );
}
