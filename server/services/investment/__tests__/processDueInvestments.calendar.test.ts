import { describe, expect, it } from "vitest";
import { calculateNextDate } from "../processDueInvestments";

// The baseline accepts fewer arguments. Calling its real export with the
// approved anchor argument reproduces date drift rather than an import error.
const advance: (due: Date, frequency: string, initialDate: string) => Date = calculateNextDate;

const cases = [
  ["daily", "2026-03-08", "2026-03-08", "2026-03-09"],
  ["weekly", "2026-10-31", "2026-10-31", "2026-11-07"],
  ["biweekly", "2026-10-31", "2026-10-31", "2026-11-14"],
  ["monthly", "2027-01-31", "2027-01-31", "2027-02-28"],
  ["monthly", "2027-01-31", "2027-02-28", "2027-03-31"],
  ["monthly", "2028-01-31", "2028-01-31", "2028-02-29"],
  ["monthly", "2028-01-31", "2028-02-29", "2028-03-31"],
  ["monthly", "2027-08-31", "2027-08-31", "2027-09-30"],
  ["monthly", "2027-08-31", "2027-09-30", "2027-10-31"],
  ["monthly", "2027-01-31", "2027-03-03", "2027-04-30"],
  ["quarterly", "2027-01-31", "2027-01-31", "2027-04-30"],
  ["quarterly", "2027-01-31", "2027-04-30", "2027-07-31"],
  ["semi_annually", "2026-08-31", "2026-08-31", "2027-02-28"],
  ["semi_annually", "2026-08-31", "2027-02-28", "2027-08-31"],
  ["annually", "2024-02-29", "2024-02-29", "2025-02-28"],
  ["annually", "2024-02-29", "2027-02-28", "2028-02-29"],
  ["yearly", "2024-02-29", "2024-02-29", "2025-02-28"],
  ["yearly", "2024-02-29", "2027-02-28", "2028-02-29"],
] as const;

describe("SIP due-date advancement", () => {
  it.each([
    ["UTC", 0], ["Africa/Lusaka", -120], ["America/Los_Angeles", 480], ["Pacific/Apia", -780],
  ] as const)("advances every supported frequency on calendar dates under %s", (zone, offset) => {
    const original = process.env.TZ;
    try {
      process.env.TZ = zone;
      expect(new Date("2026-03-08T00:00:00Z").getTimezoneOffset()).toBe(offset);
      for (const [frequency, initialDate, due, expected] of cases) {
        const advanced = advance(new Date(due), frequency, initialDate);
        expect.soft(advanced.toISOString().slice(0, 10), `${frequency} from ${due} with anchor ${initialDate}`).toBe(expected);
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it.each(["custom", "unknown"])("refuses unsupported SIP frequency %s", frequency => {
    expect(() => advance(new Date("2027-01-31"), frequency, "2027-01-31")).toThrow();
  });
});
