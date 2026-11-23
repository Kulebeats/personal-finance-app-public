/**
 * Switches for scheduled work (OPS-003).
 *
 * One flag, SCHEDULER_ENABLED, controls the in-process scheduler and the outbox
 * event processor together. It defaults on in production and off elsewhere.
 * Under NODE_ENV=test it is always off, whatever the flag says, so a stray
 * `.env` value can never start background financial work inside a test run.
 */
/** Only the switches read here, so both process.env and a parsed env fit. */
export type FlagEnv = {
  readonly NODE_ENV?: string;
  readonly SCHEDULER_ENABLED?: string;
  readonly CRON_HTTP_ENABLED?: string;
  readonly [key: string]: unknown;
};

export function isSchedulerEnabled(env: FlagEnv = process.env): boolean {
  if (env.NODE_ENV === "test") return false;
  if (env.SCHEDULER_ENABLED === "true") return true;
  if (env.SCHEDULER_ENABLED === "false") return false;
  return env.NODE_ENV === "production";
}

/**
 * Whether this profile is meant to run the scheduler: production, where it
 * defaults on and, on the declared single instance (SCP-306), no other process
 * runs the jobs. Readiness is never healthy when this is true and the
 * scheduler is switched off.
 */
export function isSchedulerExpected(env: FlagEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

/**
 * The HTTP trigger door (`/api/cron/*`) stays mounted unless explicitly turned
 * off. While it is mounted without CRON_SECRET, every request is refused.
 */
export function isCronHttpEnabled(env: FlagEnv = process.env): boolean {
  return env.CRON_HTTP_ENABLED !== "false";
}
