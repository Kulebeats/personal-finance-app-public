/** Resolve quiet hours in the subject's IANA timezone, including DST changes.
 * Scan real minutes rather than inventing a local-to-UTC offset on a DST fold.
 * Invalid configuration fails closed; R16 owns its configuration API/UI. */
export function quietHoursRetryAt(quiet: { enabled: boolean | null; startTime: string; endTime: string } | undefined,
  timezone: string | null, now: Date): Date | null {
  if (!quiet?.enabled) return null;
  const parse = (time: string) => {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
    if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] ?? 0) !== 0) throw new Error("invalid_quiet_hours");
    return +match[1] * 60 + +match[2];
  };
  const start = parse(quiet.startTime), end = parse(quiet.endTime);
  if (start === end || !timezone) throw new Error("invalid_quiet_hours");
  const format = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const inside = (date: Date) => {
    const parts = format.formatToParts(date);
    const minute = +parts.find((part) => part.type === "hour")!.value * 60 + +parts.find((part) => part.type === "minute")!.value;
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  };
  if (!inside(now)) return null;
  const nextMinute = Math.floor(now.getTime() / 60000) * 60000 + 60000;
  for (let minute = 0; minute < 26 * 60; minute++) {
    const candidate = new Date(nextMinute + minute * 60000);
    if (!inside(candidate)) return candidate;
  }
  throw new Error("invalid_quiet_hours");
}
