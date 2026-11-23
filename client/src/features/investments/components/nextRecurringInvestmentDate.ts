/** Advance the saved zone's calendar date without adding elapsed hours. */
export function nextRecurringInvestmentDate(timeZone: string, now = new Date()): string | null {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    let year = Number(parts.find(part => part.type === "year")?.value);
    let month = Number(parts.find(part => part.type === "month")?.value);
    let day = Number(parts.find(part => part.type === "day")?.value);
    if (!Number.isInteger(year) || year < 1 || year > 9999 ||
        !Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(day) || day < 1) return null;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > monthDays[month - 1]) return null;
    day++;
    if (day > monthDays[month - 1]) {
      day = 1;
      month++;
      if (month > 12) { month = 1; year++; }
    }
    if (year > 9999) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  } catch {
    return null;
  }
}
