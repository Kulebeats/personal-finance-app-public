/** Pure quiet-hours window rules: no database, safe to import from validation. */

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock HH:MM in `zone` at `at`. */
export function localTime(at: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/** [start, end): a window whose start is after its end runs through midnight. */
export function isWithinWindow(current: string, start: string, end: string): boolean {
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}
