import { describe, expect, it } from "vitest";
import { householdCalendarDate, normalizeHouseholdTimeZone } from "@shared/household-calendar";

// Source preparation only. Main owns all execution, including pure unit checks.
describe("explicit household calendar", () => {
  it("accepts explicit UTC and consistently canonicalizes a recognized named alias", () => {
    expect(normalizeHouseholdTimeZone("UTC")).toBe("UTC");
    expect(normalizeHouseholdTimeZone("US/Eastern")).toBe("America/New_York");
  });

  it.each([null, undefined, "", " Africa/Lusaka", "Africa/Lusaka ", "Africa/Unknown", "\u0000", "+02:00", "-0500", "UTC+02:00", "GMT+2", "Africa/\nLusaka"])(
    "never substitutes a default for an unsupported household choice %#", input => {
      expect(() => normalizeHouseholdTimeZone(input)).toThrow();
    },
  );

  it("uses one supplied instant in the shared zone across a UTC date boundary", () => {
    const instant = new Date("2026-11-14T22:30:00.000Z");
    expect(householdCalendarDate(instant, "Africa/Lusaka")).toBe("2026-11-15");
    expect(householdCalendarDate(instant, "UTC")).toBe("2026-11-14");
    expect(householdCalendarDate(instant, "America/New_York")).toBe("2026-11-14");
    expect(instant.toISOString()).toBe("2026-11-14T22:30:00.000Z");
  });

  it("handles the named zone's calendar across a DST transition without adding 24 hours", () => {
    expect(householdCalendarDate(new Date("2026-03-08T04:30:00Z"), "America/New_York")).toBe("2026-03-07");
    expect(householdCalendarDate(new Date("2026-03-09T03:30:00Z"), "America/New_York")).toBe("2026-03-08");
  });

  it("refuses invalid instants or unconfigured/unsupported stored zones", () => {
    expect(() => householdCalendarDate(new Date("invalid"), "UTC")).toThrow();
    expect(() => householdCalendarDate(new Date("2026-11-14T12:00:00Z"), "")).toThrow();
    expect(() => householdCalendarDate(new Date("2026-11-14T12:00:00Z"), "Unknown/Zone")).toThrow();
  });

  it.each([
    ["0000-06-01T12:00:00Z", "UTC"],
    ["-000001-06-01T12:00:00Z", "UTC"],
    ["+010000-01-01T12:00:00Z", "UTC"],
    ["0001-01-01T00:15:00Z", "Etc/GMT+1"],
    ["9999-12-31T23:30:00Z", "Africa/Lusaka"],
  ])("rejects an out-of-domain chosen-zone calendar date %#", (instant, zone) => {
    expect(() => householdCalendarDate(new Date(instant), zone)).toThrow();
  });

  it("preserves the real AD four-digit domain endpoints", () => {
    expect(householdCalendarDate(new Date("0001-01-01T00:00:00Z"), "UTC")).toBe("0001-01-01");
    expect(householdCalendarDate(new Date("9999-12-31T23:59:00Z"), "UTC")).toBe("9999-12-31");
  });
});
