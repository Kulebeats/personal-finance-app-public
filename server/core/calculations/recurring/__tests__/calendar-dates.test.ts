import { describe, expect, it, vi, afterEach } from "vitest";
import { toMoney } from "../../types";
import { calculateNextDate } from "../dates";
import { projectOccurrences } from "../projections";

describe.each(["UTC", "Africa/Lusaka", "America/Los_Angeles", "Pacific/Apia"])(
  "recurring calendar in %s",
  zone => {
    afterEach(() => vi.unstubAllEnvs());

    it("projects each calendar day across the month boundary", () => {
      vi.stubEnv("TZ", zone);
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
      const occurrences = projectOccurrences({
        frequency: "daily", startDate: "2026-01-31", nextDueDate: "2026-01-31", amount: toMoney(12),
      }, "2026-02-02");
      expect(occurrences.map(item => item.date)).toEqual(["2026-01-31", "2026-02-01", "2026-02-02"]);
      expect(calculateNextDate("2011-12-29", "daily")).toBe("2011-12-30");
    });

    it("keeps the weekly interval and Sunday anchor across a daylight-saving change", () => {
      vi.stubEnv("TZ", zone);
      expect(calculateNextDate("2026-03-08", "weekly")).toBe("2026-03-15");
      expect(calculateNextDate("2026-03-07", "custom", {
        intervalValue: 2, intervalUnit: "weeks", dayOfWeek: 0,
      })).toBe("2026-03-22");
    });

    it("retains the requested month-end anchor through February and leap years", () => {
      vi.stubEnv("TZ", zone);
      const february = calculateNextDate("2024-01-31", "monthly", { dayOfMonth: 31 });
      expect(february).toBe("2024-02-29");
      expect(calculateNextDate(february, "monthly", { dayOfMonth: 31 })).toBe("2024-03-31");
      expect(calculateNextDate("2024-02-29", "yearly")).toBe("2025-02-28");
      expect(calculateNextDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    });
  },
);
