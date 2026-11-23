/** CSV dates represent calendar days, never instants in the host timezone. */
export const IMPORT_DATE_FORMATS = ["auto", "DD/MM/YYYY", "MM/DD/YYYY"] as const;
export type ImportDateFormat = typeof IMPORT_DATE_FORMATS[number];
export type ImportDateResult = { dateString: string; error?: never } |
  { dateString?: never; error: string };

const MONTHS = ["january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december"];

function calendarDate(year: number, month: number, day: number): ImportDateResult {
  const date = new Date(0);
  // setUTCFullYear avoids Date.UTC's special interpretation of years 00–99.
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) {
    return { error: "Invalid date: the calendar day does not exist" };
  }
  return { dateString: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

/**
 * Supported unambiguous inputs: year-first ISO/hyphen or slash dates, numeric
 * day/month or month/day with four-digit year, and English month names.
 * ISO timestamps retain the date written in the source, after validating their
 * time/offset components. No local/native Date parser or product date bounds.
 * Explicit ordering applies to numeric year-last slash dates only.
 */
export function normalizeImportDate(
  raw: string | undefined,
  dateFormat: ImportDateFormat = "auto",
): ImportDateResult {
  const value = raw?.trim() ?? "";
  if (!value) return { error: "Date is required" };
  if (!IMPORT_DATE_FORMATS.includes(dateFormat)) return { error: "Unsupported date format" };

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (iso) {
    if (iso[4] !== undefined) {
      const offset = iso[8] && /^[+-](\d{2}):?(\d{2})$/.exec(iso[8]);
      if (+iso[4] > 23 || +iso[5] > 59 || +(iso[6] ?? 0) > 59 ||
          (offset && (+offset[1] > 23 || +offset[2] > 59))) return { error: "Invalid date" };
    }
    return calendarDate(+iso[1], +iso[2], +iso[3]);
  }

  const yearFirst = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (yearFirst) return calendarDate(+yearFirst[1], +yearFirst[2], +yearFirst[3]);

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash) {
    const first = +slash[1], second = +slash[2], year = +slash[3];
    if (dateFormat === "DD/MM/YYYY") return calendarDate(year, second, first);
    if (dateFormat === "MM/DD/YYYY") return calendarDate(year, first, second);
    const dmy = calendarDate(year, second, first);
    const mdy = calendarDate(year, first, second);
    if (dmy.dateString && mdy.dateString && dmy.dateString !== mdy.dateString) {
      return { error: "Ambiguous date: choose DD/MM/YYYY or MM/DD/YYYY" };
    }
    return dmy.dateString ? dmy : mdy;
  }

  const named = /^(?:([a-z]+)\s+(\d{1,2}),?|(\d{1,2})[\s-]+([a-z]+)),?[\s-]+(\d{4})$/i.exec(value);
  if (named) {
    const monthName = (named[1] ?? named[4]).toLowerCase();
    const monthIndex = MONTHS.findIndex(month => month === monthName || month.slice(0, 3) === monthName);
    if (monthIndex >= 0) return calendarDate(+named[5], monthIndex + 1, +(named[2] ?? named[3]));
  }
  return { error: "Invalid date" };
}

/** Direct account APIs accept only normalized dates, independent of UI parsing. */
export function isCanonicalImportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && normalizeImportDate(value).dateString === value;
}
