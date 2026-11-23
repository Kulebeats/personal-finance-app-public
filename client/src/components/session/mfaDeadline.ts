/** "7 December 2026" style date for the MFA deadline (AH-11); the raw text if unreadable. */
export function formatMfaDeadline(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export function daysLeftLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
