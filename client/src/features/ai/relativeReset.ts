/**
 * Human-readable countdown to the AI quota reset (spec state 5.4).
 *
 * The reset timestamp comes from GET /api/ai/status as an ISO string and is
 * rendered relative to now.
 *
 * A 429 from /api/ai/chat does now carry RateLimit-Reset and Retry-After, but
 * both are delta-seconds rather than an instant, so they are not interchangeable
 * with this input. Pass an ISO timestamp; use the headers only if this is
 * reworked to take a delta.
 */

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;

export function formatRelativeReset(resetTime: string): string | null {
  const target = new Date(resetTime).getTime();
  if (Number.isNaN(target)) return null;

  const diffMs = target - Date.now();
  if (diffMs < MINUTE_MS) return "soon";

  const minutes = Math.round(diffMs / MINUTE_MS);
  if (minutes < MINUTES_PER_HOUR) {
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.round(minutes / MINUTES_PER_HOUR);
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}
