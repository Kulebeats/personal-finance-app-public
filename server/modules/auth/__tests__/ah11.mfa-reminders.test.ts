import { describe, expect, it } from "vitest";
import { mfaReminderEventKey, reminderStageFor } from "../auth.mfa-reminders";

// AH-11 slice 2: which grace reminder, if any, is due, and the delivery-ledger key that sends it once.
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const now = new Date("2026-12-01T08:45:00.000Z");
const endsIn = (ms: number) => new Date(now.getTime() + ms);

describe("AH-11 MFA grace reminder stage", () => {
  it.each([
    [8 * DAY_MS, null],
    [7 * DAY_MS + 1, null],
    [7 * DAY_MS, 7],
    [3 * DAY_MS, 7],
    [DAY_MS + 1, 7],
    [DAY_MS, 1],
    [HOUR_MS, 1],
    [0, null],
    [-HOUR_MS, null],
  ])("a deadline %i ms away is stage %s", (ms, stage) => {
    expect(reminderStageFor(endsIn(ms), now)).toBe(stage);
  });

  it("keys a reminder by its stage and the deadline it is about", () => {
    const deadline = endsIn(7 * DAY_MS);
    expect(mfaReminderEventKey(7, deadline)).toBe("mfa_grace_reminder:7d:2026-12-08T08:45:00.000Z");
    expect(mfaReminderEventKey(1, deadline)).toBe("mfa_grace_reminder:1d:2026-12-08T08:45:00.000Z");
  });
});
