/** Real PostgreSQL. Households and journal rows from other suites may be present. */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { accountWorthCaptureGenerations, accounts, accountWorthCaptures, households, jobs, netWorthSnapshots } from "@shared/schema";
import { db } from "../../../db";
import { snapshotWorker } from "../../../jobs/snapshotWorker";
import { initScheduler, stopScheduler } from "../../../scheduler";
import { SCHEDULED_RUN_PREFIX, SCHEDULER_START_MARKER } from "../jobJournal";
import { SCHEDULED_JOBS } from "../jobRegistry";
import { periodIdentity } from "../schedulePeriod";

const ticks = vi.hoisted(() => new Map<string, () => Promise<void>>());
vi.mock("node-cron", async original => {
  const cron = await original<typeof import("node-cron")>();
  return { default: { validate: cron.validate, schedule: (_spec: string, tick: () => Promise<void>, options: { name: string }) => {
    ticks.set(options.name, tick);
    return { stop: async () => {} };
  } } };
});
vi.mock("../../events/processor", () => ({ startProcessor: vi.fn(), stopProcessor: vi.fn() }));
vi.mock("../../../config/redis", async original => ({
  ...await original<typeof import("../../../config/redis")>(), productionRedis: null, redis: null,
}));

const good = randomUUID();
const missing = randomUUID();
const legacy = randomUUID();
const manual = randomUUID();
const householdIds = [good, missing, legacy, manual];
const goodAccount = randomUUID();
const missingAccount = randomUUID();
const legacyAccount = randomUUID();
const manualAccount = randomUUID();
const generations = new Set<string>();
let day: string | undefined;
let ownsStartMarker = false;
let scheduled = false;
const snapshotJob = "snapshots.daily";
const retryTask = "scheduler.retry-incomplete";
const runName = `${SCHEDULED_RUN_PREFIX}${snapshotJob}`;
const slotAt = (date: string, time: string) => new Date(`${date}T${time}:00.000Z`);
const marker = () => db.select({ id: jobs.id }).from(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER));

async function captures() {
  const rows = await db.select().from(accountWorthCaptures).where(inArray(accountWorthCaptures.householdId, householdIds))
    .orderBy(accountWorthCaptures.householdId);
  for (const row of rows) generations.add(row.captureId);
  return rows;
}

const snapshots = () => db.select().from(netWorthSnapshots)
  .where(inArray(netWorthSnapshots.householdId, householdIds)).orderBy(netWorthSnapshots.householdId);
const snapshotJournal = (slot: Date) => and(eq(jobs.name, runName), eq(jobs.idempotencyKey, periodIdentity(snapshotJob, slot)));

afterAll(async () => {
  await stopScheduler();
  await captures();
  await db.delete(households).where(inArray(households.id, householdIds));
  // Spent IDs are opaque and immutable under migration 0019. Allow them to
  // remain in this disposable target and verify cleanup of identifying rows.
  expect(await snapshots()).toEqual([]);
  expect(await captures()).toEqual([]);
  if (generations.size) {
    const spent = await db.select().from(accountWorthCaptureGenerations)
      .where(inArray(accountWorthCaptureGenerations.captureId, [...generations]));
    expect(spent).toHaveLength(generations.size);
  }
  if (scheduled && day) await db.delete(jobs).where(snapshotJournal(slotAt(day, "03:00")));
  if (scheduled && ownsStartMarker) {
    await vi.waitFor(async () => expect(await marker()).toHaveLength(1), { timeout: 5000 });
    await db.delete(jobs).where(eq(jobs.name, SCHEDULER_START_MARKER));
  }
});

describe("A-15 registered snapshot recovery", () => {
  it("keeps scheduled and newer manual aggregates through retry and recovers native-only households", async () => {
    const today = await db.execute<{ day: string }>(sql`select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD') as day`);
    day = today.rows[0].day;
    const slot = slotAt(day, "03:00");
    const readJournal = () => db.select({ status: jobs.status, result: jobs.result })
      .from(jobs).where(snapshotJournal(slot)).orderBy(jobs.startedAt);
    // This period starts clean even if another run left rows for it.
    await db.delete(jobs).where(snapshotJournal(slot));
    ownsStartMarker = (await marker()).length === 0;
    await db.insert(households).values([
      { id: good, name: "Synthetic A15 completed", currency: "ZMW" },
      { id: missing, name: "Synthetic A15 unpriced", currency: "ZMW" },
      { id: legacy, name: "Synthetic A15 unknown provenance", currency: "ZMW" },
      { id: manual, name: "Synthetic A15 manual recapture", currency: "ZMW" },
    ]);
    await db.insert(accounts).values([
      { id: goodAccount, householdId: good, name: "Synthetic local", type: "checking", balance: "190.00", currency: "ZMW" },
      { id: missingAccount, householdId: missing, name: "Synthetic missing FX", type: "checking", balance: "300.00", currency: "XTS" },
      { id: legacyAccount, householdId: legacy, name: "Synthetic legacy", type: "checking", balance: "400.00", currency: "ZMW" },
      { id: manualAccount, householdId: manual, name: "Synthetic manual", type: "checking", balance: "500.00", currency: "ZMW" },
    ]);
    await db.insert(netWorthSnapshots).values({ householdId: legacy, date: day, currency: "ZMW",
      totalAssets: "999.00", totalLiabilities: "0.00", netWorth: "999.00", provenance: null });
    expect(await snapshotWorker.processHousehold(good)).toBe(true);
    await captures();
    expect((await snapshots()).find(row => row.householdId === good)?.netWorth).toBe("190.00");
    await db.update(accounts).set({ balance: "200.00" }).where(eq(accounts.id, goodAccount));

    // The scheduled runner enumerates every household. A household from another
    // suite is passed over as processed, so only the fixture can fail the run.
    const fixture = new Set<string>(householdIds);
    const others = (await db.select({ id: households.id }).from(households)).filter(row => !fixture.has(row.id)).length;
    const capture = snapshotWorker.processHousehold.bind(snapshotWorker);
    const scoped = vi.spyOn(snapshotWorker, "processHousehold").mockImplementation(
      async (...args: Parameters<typeof capture>) => fixture.has(args[0]) ? capture(...args) : true,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(slot);
      expect(initScheduler({ NODE_ENV: "production" }, SCHEDULED_JOBS.filter(job => job.name === snapshotJob))).toBe(true);
      scheduled = true;
      await ticks.get(snapshotJob)!();
      const firstCaptures = await captures();
      expect(firstCaptures).toHaveLength(4);
      expect(firstCaptures.find(row => row.householdId === missing)?.evidence).toMatchObject({ inventoryComplete: true });
      const first = await snapshots();
      expect(first).toHaveLength(3);
      const goodSnapshot = first.find(row => row.householdId === good)!;
      expect(goodSnapshot).toMatchObject({ householdId: good, netWorth: "200.00" });
      const legacySnapshot = first.find(row => row.householdId === legacy)!;
      expect(legacySnapshot.netWorth).toBe("400.00");
      const scheduledManualSnapshot = first.find(row => row.householdId === manual)!;
      expect(scheduledManualSnapshot.netWorth).toBe("500.00");
      const originalManualCapture = firstCaptures.find(row => row.householdId === manual)!;
      const manualSlotReceipt = { version: 1, job: snapshotJob, householdId: manual, date: day, captureId: originalManualCapture.captureId };
      expect.soft(scheduledManualSnapshot.provenance).toMatchObject({ scheduledCapture: manualSlotReceipt });
      const goodProof = goodSnapshot.provenance as { captureId: string; scheduledCapture: unknown };
      const goodSlotReceipt = { version: 1, job: snapshotJob, householdId: good, date: day, captureId: goodProof.captureId };
      expect.soft(goodProof.scheduledCapture).toEqual(goodSlotReceipt);
      expect(await readJournal()).toMatchObject([{ status: "failed", result: { processed: 3 + others, failed: 1 } }]);

      if (ownsStartMarker) await vi.waitFor(async () => expect(await marker()).toHaveLength(1));
      await stopScheduler();
      ticks.clear();

      // An unavailable manual recapture advances native evidence only. The
      // aggregate already committed for the slot must survive the restart.
      await db.update(accounts).set({ currency: "XTS" }).where(eq(accounts.id, goodAccount));
      await expect(snapshotWorker.processHousehold(good)).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
      const afterNativeOnly = await captures();
      expect(afterNativeOnly.find(row => row.householdId === good)?.captureId)
        .not.toBe(firstCaptures.find(row => row.householdId === good)?.captureId);
      expect(await snapshots()).toEqual(first);

      // A successful manual recapture keeps its new observation and the
      // earlier slot completion. Later balance changes must not replace it.
      await db.update(accounts).set({ balance: "545.00" }).where(eq(accounts.id, manualAccount));
      expect(await snapshotWorker.processHousehold(manual)).toBe(true);
      const refreshed = (await snapshots()).find(row => row.householdId === manual)!;
      const refreshedCapture = (await captures()).find(row => row.householdId === manual)!;
      expect(refreshed.netWorth).toBe("545.00");
      expect(refreshedCapture.captureId).not.toBe(originalManualCapture.captureId);
      expect(refreshed.provenance).toMatchObject({ captureId: refreshedCapture.captureId });
      expect.soft(refreshed.provenance).toMatchObject({ scheduledCapture: manualSlotReceipt });
      await db.update(accounts).set({ balance: "575.00" }).where(eq(accounts.id, manualAccount));

      // A spent ID copied from a different household cannot stand in for the
      // legacy household's scheduled receipt, even when the row shape is valid.
      await db.update(netWorthSnapshots).set({ provenance: {
        ...(legacySnapshot.provenance as object), captureId: goodProof.captureId, scheduledCapture: goodSlotReceipt,
      } }).where(eq(netWorthSnapshots.id, legacySnapshot.id));
      expect((await snapshots()).find(row => row.householdId === legacy)?.provenance)
        .toMatchObject({ captureId: goodProof.captureId, scheduledCapture: goodSlotReceipt });
      await db.update(accounts).set({ balance: "250.00", currency: "ZMW" }).where(eq(accounts.id, goodAccount));
      await db.update(accounts).set({ currency: "ZMW" }).where(eq(accounts.id, missingAccount));
      await db.update(accounts).set({ balance: "425.00" }).where(eq(accounts.id, legacyAccount));
      vi.setSystemTime(slotAt(day, "03:07"));
      expect(initScheduler({ NODE_ENV: "production" }, SCHEDULED_JOBS.filter(job => job.name === snapshotJob))).toBe(true);
      const retry = ticks.get(retryTask)!;
      await retry();
      const recovered = await snapshots();
      const recoveredCaptures = await captures();
      expect(recovered).toHaveLength(4);
      expect(recovered.find(row => row.householdId === good)).toEqual(goodSnapshot);
      expect(recoveredCaptures.find(row => row.householdId === good)).toEqual(afterNativeOnly.find(row => row.householdId === good));
      expect.soft(recovered.find(row => row.householdId === manual)).toEqual(refreshed);
      expect.soft(recoveredCaptures.find(row => row.householdId === manual)).toEqual(refreshedCapture);
      expect(recovered.find(row => row.householdId === missing)).toMatchObject({ netWorth: "300.00" });
      expect(recovered.find(row => row.householdId === legacy)).toMatchObject({ netWorth: "425.00" });
      expect(await readJournal()).toMatchObject([{ status: "failed" }, { status: "completed", result: { failed: 0 } }]);

      vi.setSystemTime(slotAt(day, "03:22"));
      await retry();
      expect(await readJournal()).toHaveLength(2);
      expect(await snapshots()).toEqual(recovered);

      const yesterday = new Date(slot.getTime() - 86_400_000).toISOString().slice(0, 10);
      // The same fixture also overlays the earlier one-argument worker.
      const captureForDate: (householdId: string, scheduledDate?: string) => Promise<boolean> =
        snapshotWorker.processHousehold.bind(snapshotWorker);
      await expect(captureForDate(good, yesterday)).rejects.toThrow("Scheduled snapshot date is no longer current");
      expect(await snapshots()).toEqual(recovered);
      expect(await snapshotWorker.processHousehold(good)).toBe(true);
      expect((await snapshots()).find(row => row.householdId === good)).toMatchObject({ netWorth: "250.00" });
    } finally {
      scoped.mockRestore();
      vi.useRealTimers();
    }
  }, 45_000);
});
