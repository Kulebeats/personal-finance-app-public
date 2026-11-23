import { describe, expect, it } from "vitest";
import { SCHEDULED_JOB_SPECS } from "../jobCatalog";
import { periodIdentity, scheduledSlotAtOrBefore } from "../schedulePeriod";

// OPS-013: a run is identified by the scheduled slot it belongs to, not by the
// moment it happened to start, so a delayed tick still names its own period.
const at = (iso: string) => new Date(iso);

describe("scheduledSlotAtOrBefore", () => {
  it.each([
    ["2026-11-17T01:00:00.400Z", "2026-11-17T01:00:00.000Z"],
    ["2026-11-17T01:07:00.000Z", "2026-11-17T01:00:00.000Z"],
    ["2026-11-17T23:59:59.999Z", "2026-11-17T01:00:00.000Z"],
    ["2026-11-17T00:59:59.999Z", "2026-11-16T01:00:00.000Z"],
    ["2026-03-01T00:30:00.000Z", "2026-02-28T01:00:00.000Z"],
  ])("maps a daily 01:00 tick at %s to the slot %s", (now, slot) => {
    expect(scheduledSlotAtOrBefore("0 1 * * *", at(now)).toISOString()).toBe(slot);
  });

  it.each([
    ["2026-11-16T09:00:00.000Z", "2026-11-16T09:00:00.000Z"],
    ["2026-11-17T10:00:00.000Z", "2026-11-16T09:00:00.000Z"],
    ["2026-11-22T23:00:00.000Z", "2026-11-16T09:00:00.000Z"],
    ["2026-11-16T08:59:00.000Z", "2026-11-09T09:00:00.000Z"],
  ])("maps a Monday 09:00 weekly tick at %s to the slot %s", (now, slot) => {
    expect(scheduledSlotAtOrBefore("0 9 * * 1", at(now)).toISOString()).toBe(slot);
  });

  it("gives every catalogued job a slot within one interval before now", () => {
    const now = at("2026-11-17T12:34:56.000Z");
    for (const spec of SCHEDULED_JOB_SPECS) {
      const slot = scheduledSlotAtOrBefore(spec.cron, now);
      expect(slot.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(now.getTime() - slot.getTime()).toBeLessThan(spec.intervalMs);
    }
  });

  it.each(["*/5 * * * *", "0 1 1 * *", "0 1 * 2 *", "0 24 * * *", "60 1 * * *", "0 1 * * 7", "0 1 * *", "bad"])(
    "refuses the schedule %s, whose period it cannot name",
    (cron) => {
      expect(() => scheduledSlotAtOrBefore(cron, at("2026-11-17T12:00:00.000Z"))).toThrow("UNSUPPORTED_SCHEDULE");
    },
  );
});

describe("periodIdentity", () => {
  it("names the job and its slot, so yesterday's late run and today's run differ", () => {
    const yesterday = scheduledSlotAtOrBefore("0 1 * * *", at("2026-11-18T00:30:00.000Z"));
    const today = scheduledSlotAtOrBefore("0 1 * * *", at("2026-11-18T01:00:00.000Z"));

    expect(periodIdentity("recurring.materialize", yesterday)).toBe("recurring.materialize@2026-11-17T01:00:00.000Z");
    expect(periodIdentity("recurring.materialize", today)).toBe("recurring.materialize@2026-11-18T01:00:00.000Z");
  });
});
