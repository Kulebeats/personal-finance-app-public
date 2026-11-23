/**
 * NEW-15: "this month" is the household's calendar month, not the UTC one
 * and not the browser's. Runs in the client-tz-new-york project so the
 * browser zone (UTC-5) disagrees with both UTC and the household zone.
 */
import { describe, it, expect } from "vitest";
import { householdMonthRange } from "@shared/household-calendar";

const LUSAKA = "Africa/Lusaka";

describe("householdMonthRange", () => {
  it("is the Lusaka month at 00:30 on 1 October, while UTC and New York still read 30 September", () => {
    const instant = new Date("2026-09-30T22:30:00Z");
    expect(householdMonthRange(instant, LUSAKA)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("is still September in Lusaka at 23:30 on 30 September local", () => {
    const instant = new Date("2026-09-30T21:30:00Z");
    expect(householdMonthRange(instant, LUSAKA)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("follows the household zone west of UTC as well", () => {
    const instant = new Date("2026-11-01T02:00:00Z"); // 31 Oct 22:00 in New York
    expect(householdMonthRange(instant, "America/New_York")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("shifts by whole calendar months across a year boundary", () => {
    const instant = new Date("2026-01-15T10:00:00Z");
    expect(householdMonthRange(instant, LUSAKA, -1)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(householdMonthRange(instant, LUSAKA, 1)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("knows leap-year February", () => {
    expect(householdMonthRange(new Date("2028-02-10T10:00:00Z"), LUSAKA)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("refuses an unnamed zone", () => {
    expect(() => householdMonthRange(new Date(), "UTC+2")).toThrow();
  });
});
