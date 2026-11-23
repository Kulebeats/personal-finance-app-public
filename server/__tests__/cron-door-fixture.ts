/**
 * Real-DB tests that call the HTTP cron door. The door runs each job once per
 * scheduled period (the scheduler's journal), and a job with a recovery window
 * only inside it. A test that calls the door several times, or at any hour,
 * makes each call a fresh period whose window is open:
 *   - the period's journal rows are removed before and after the call;
 *   - before today's slot of a windowed job, the clock (Date only) is moved to
 *     just after that slot on the same UTC date, so "today" does not change.
 */
import type { Express } from "express";
import request, { type Response } from "supertest";
import { and, eq } from "drizzle-orm";
import { vi } from "vitest";
import { jobs } from "@shared/schema";
import { db } from "../db";
import { SCHEDULED_JOB_SPECS, recoveryWindowDays, type ScheduledJobName } from "../core/scheduling/jobCatalog";
import { SCHEDULED_RUN_PREFIX } from "../core/scheduling/jobJournal";
import { isWithinScheduledWindow, periodIdentity, scheduledSlotAtOrBefore } from "../core/scheduling/schedulePeriod";
import { DOOR_ROUTES } from "../routes/cron";

const AFTER_SLOT_MS = 60_000;

function cronOf(name: ScheduledJobName): string {
  const spec = SCHEDULED_JOB_SPECS.find((candidate) => candidate.name === name);
  if (!spec) throw new Error(`no catalogued job ${name}`);
  return spec.cron;
}

/** Just after today's slot when a windowed job's latest slot is closed; undefined when every window is open. */
function openWindowTime(names: readonly ScheduledJobName[], now: Date): Date | undefined {
  let latest: Date | undefined;
  for (const name of names) {
    const days = recoveryWindowDays(name);
    if (days === undefined || isWithinScheduledWindow(scheduledSlotAtOrBefore(cronOf(name), now), now, days)) continue;
    const [minute, hour] = cronOf(name).split(" ").map(Number);
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute) + AFTER_SLOT_MS);
    if (!isWithinScheduledWindow(scheduledSlotAtOrBefore(cronOf(name), target), target, days)) {
      throw new Error(`the cron door cannot open ${name} on this UTC date`);
    }
    if (!latest || target > latest) latest = target;
  }
  return latest;
}

async function clearPeriods(names: readonly ScheduledJobName[], at: Date): Promise<void> {
  for (const name of names) {
    const identity = periodIdentity(name, scheduledSlotAtOrBefore(cronOf(name), at));
    await db.delete(jobs).where(and(eq(jobs.name, `${SCHEDULED_RUN_PREFIX}${name}`), eq(jobs.idempotencyKey, identity)));
  }
}

/** POST /api/cron/<route> as the external cron would, as a fresh, open period of the route's jobs. */
export async function postCronDoor(app: Express, route: string, secret: string): Promise<Response> {
  const names = DOOR_ROUTES[route];
  if (!names) throw new Error(`no cron door route ${route}`);
  const target = openWindowTime(names, new Date());
  if (target) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(target);
  }
  try {
    const at = new Date();
    await clearPeriods(names, at);
    try {
      return await request(app).post(`/api/cron/${route}`).set("x-cron-secret", secret);
    } finally {
      await clearPeriods(names, at);
    }
  } finally {
    if (target) vi.useRealTimers();
  }
}
