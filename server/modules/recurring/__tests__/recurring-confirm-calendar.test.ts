import { describe, expect, it } from "vitest";
import { inferPatternCalendar, resolvePatternWindow } from "../../../services/recurring/RecurringPatternSelection";
import { patternOptionsSchema } from "@shared/recurring-pattern";

describe("signed pattern calendar inference uses date-only UTC fields and an explicit household window", () => {
  it.each(["America/Los_Angeles", "UTC", "Africa/Lusaka"])("retains month-end/leap anchors and off-anchor Sunday zero on %s", timezone => {
    const original = process.env.TZ;
    try {
      process.env.TZ = timezone;
      expect(inferPatternCalendar(["2024-01-31", "2024-02-29", "2024-03-31"]).dayOfMonth).toBe(31);
      expect(inferPatternCalendar(["2026-01-31", "2026-02-28", "2026-03-31"]).dayOfMonth).toBe(31);
      expect(inferPatternCalendar(["2026-10-04", "2026-10-11", "2026-10-19"]).dayOfWeek).toBe(0);
      expect(resolvePatternWindow(patternOptionsSchema.parse({}), "Africa/Lusaka", new Date("2026-11-01T22:30:00Z")))
        .toEqual({ startDate: "2026-05-02", endDate: "2026-11-02" });
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
