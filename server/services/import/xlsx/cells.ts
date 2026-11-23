/**
 * IMP-01 cell values as text. Numbers stay the exact stored decimal (the XML
 * text, exponents expanded by string shifting, never a float, never rounded). Date
 * serials become calendar days by integer arithmetic only: no JS Date and no
 * time zone, so the day written in the sheet is the day imported. Whether a
 * number is a date comes from its format, via SheetJS (owner decision N2).
 */
import Decimal from "decimal.js";

/** 1900 system: serial 60 is Excel's fictitious 29 Feb 1900. */
const FICTITIOUS_LEAP_DAY = 60;
/** Days from 1970-01-01 back to each system's day zero. */
const EPOCH_1900_BEFORE_LEAP_BUG = -25568; // serial 1 = 1900-01-01
const EPOCH_1900_AFTER_LEAP_BUG = -25569; // serial 61 = 1900-03-01
const EPOCH_1904 = -24107; // serial 0 = 1904-01-01
const MAX_SERIAL = 2958465; // 9999-12-31 in the 1900 system
const MAX_SERIAL_1904 = MAX_SERIAL - 1462; // 9999-12-31 in the 1904 system

/** Howard Hinnant's civil_from_days: days since 1970-01-01 to a proleptic Gregorian date. */
function civilFromDays(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Inverse of civilFromDays (Hinnant's days_from_civil). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 1900-system serial of a YYYY-MM-DD day on or after 1900-03-01 (template writer and tests). */
export function calendarDateToSerial(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(part => parseInt(part, 10));
  return daysFromCivil(year, month, day) - EPOCH_1900_AFTER_LEAP_BUG;
}

const MS_PER_DAY = BigInt(86400000);

/**
 * Whether a time of day (the serial's fraction digits) rounds up to the next
 * midnight at Excel's millisecond resolution: 45000.99999999999 is the next
 * day in Excel (review r2 P2). Exact integer arithmetic, half up.
 */
function roundsToNextDay(fraction: string): boolean {
  if (!fraction) return false;
  const scale = BigInt(10) ** BigInt(fraction.length);
  const two = BigInt(2);
  return (BigInt(fraction) * MS_PER_DAY * two + scale) / (two * scale) >= MS_PER_DAY;
}

/**
 * Calendar day of a date serial in plain decimal text (its time of day is
 * ignored once rounded to the millisecond). Returns undefined for a serial
 * Excel itself cannot show as a date.
 */
export function serialToCalendarDate(serialText: string, date1904: boolean): string | undefined {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(serialText.trim());
  if (!match) return undefined;
  const serial = parseInt(match[1], 10) + (roundsToNextDay(match[2] ?? "") ? 1 : 0);
  // Each system ends at 9999-12-31, so the 1904 limit is lower (review r4 P2).
  if (serial > (date1904 ? MAX_SERIAL_1904 : MAX_SERIAL)) return undefined;
  if (date1904) return civilFromDays(EPOCH_1904 + serial);
  if (serial === 0 || serial === FICTITIOUS_LEAP_DAY) return undefined;
  return civilFromDays(serial < FICTITIOUS_LEAP_DAY ? EPOCH_1900_BEFORE_LEAP_BUG + serial : EPOCH_1900_AFTER_LEAP_BUG + serial);
}

/** A whole ISO 8601 date or date-time as Excel writes in `t="d"` cells. */
const ISO_CELL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/;
/** Real UTC offsets run from -12:00 to +14:00 (review r5 P2). */
const MAX_OFFSET_MINUTES = { "-": 12 * 60, "+": 14 * 60 } as const;

function isValidOffset(sign: string | undefined, hours: string | undefined, minutes: string | undefined): boolean {
  if (sign === undefined || hours === undefined || minutes === undefined) return true;
  const total = parseInt(hours, 10) * 60 + parseInt(minutes, 10);
  return parseInt(minutes, 10) <= 59 && total <= MAX_OFFSET_MINUTES[sign === "-" ? "-" : "+"];
}

/**
 * `t="d"` cells hold ISO 8601 text; the calendar day as written, or undefined
 * unless the WHOLE value is a real date and time (review r4 P2).
 */
export function isoCellToCalendarDate(text: string): string | undefined {
  const match = ISO_CELL.exec(text.trim());
  if (!match) return undefined;
  const [year, month, day, hour = 0, minute = 0, second = 0] = match.slice(1, 7)
    .map(part => (part === undefined ? undefined : parseInt(part, 10)));
  if (year === undefined || month === undefined || day === undefined) return undefined;
  if (hour > 23 || minute > 59 || second > 59 || !isValidOffset(match[7], match[8], match[9])) return undefined;
  const isoDay = `${match[1]}-${match[2]}-${match[3]}`;
  // The day must exist: 2026-02-30 round-trips to a different day.
  return month >= 1 && month <= 12 && civilFromDays(daysFromCivil(year, month, day)) === isoDay ? isoDay : undefined;
}

/** Longest number text accepted from a cell; Excel writes at most 17 digits plus sign, point and exponent. */
export const MAX_NUMBER_TEXT_LENGTH = 64;
/** Longest decimal an exponent may expand to (a double spans about 1e-324 to 1e308). */
export const MAX_EXPANDED_NUMBER_LENGTH = 400;
const NUMBER_SYNTAX = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,4}))?$/;

/**
 * Exact decimal text of an OOXML number cell: the stored value with any
 * exponent expanded by shifting the point in the digit string. Nothing is
 * rounded (review r1 P1): float noise such as 99.999999999999986 is kept as
 * stored, and the amount validator refuses that row rather than this reader
 * guessing. Syntax and expanded length are checked BEFORE any allocation;
 * undefined means the text is not a number this reader will expand.
 */
export function numberCellText(raw: string): string | undefined {
  const text = raw.trim();
  if (text.length > MAX_NUMBER_TEXT_LENGTH) return undefined;
  const match = NUMBER_SYNTAX.exec(text);
  if (!match) return undefined;
  const [, sign, whole, fraction = "", exponentText] = match;
  if (!whole && !fraction) return undefined;
  const negative = sign === "-" ? "-" : "";
  if (exponentText === undefined) return `${negative}${text.replace(/^[+-]/, "")}`;
  const digits = `${whole}${fraction}`;
  const point = whole.length + parseInt(exponentText, 10);
  const expandedLength = point <= 0 ? 2 - point + digits.length : Math.max(point, digits.length + 1);
  if (expandedLength > MAX_EXPANDED_NUMBER_LENGTH) return undefined;
  const shifted = point <= 0
    ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length
      ? digits.padEnd(point, "0")
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return `${negative}${shifted}`;
}

/** Significant digits writers save a double with: the shortest that round-trips, 15, 16 or (Excel) 17. */
const SAVED_PRECISIONS = [15, 16, 17] as const;
/** Digits that identify a double uniquely. */
const DOUBLE_DIGITS = 17;

/**
 * SheetJS's value for a number cell is the double nearest its stored text.
 * Compared as decimals, never by converting the text to a number (review r6
 * P1): the stored value must be a spelling writers save that double as, or,
 * for text longer than a double holds, round to the same 17 significant
 * digits. This only proves both readers read the same cell; the row always
 * imports the exact stored text.
 */
export function isSameStoredNumber(plain: string, value: unknown): boolean {
  if (typeof value !== "number" || !isFinite(value)) return false;
  let stored: Decimal;
  try {
    stored = new Decimal(plain);
  } catch {
    return false;
  }
  const spellings = [String(value), ...SAVED_PRECISIONS.map(digits => value.toPrecision(digits))].map(text => new Decimal(text));
  if (spellings.some(spelling => spelling.equals(stored))) return true;
  return stored.toSignificantDigits(DOUBLE_DIGITS, Decimal.ROUND_HALF_EVEN).equals(new Decimal(value.toPrecision(DOUBLE_DIGITS)));
}
