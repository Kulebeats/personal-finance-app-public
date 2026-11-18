/**
 * formatRelativeReset — quota reset countdown copy (spec state 5.4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRelativeReset } from "../relativeReset";

describe("formatRelativeReset", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats an hours-scale reset", () => {
    expect(formatRelativeReset("2026-07-17T15:30:00.000Z")).toBe("in about 4 hours");
  });

  it("formats a single hour", () => {
    expect(formatRelativeReset("2026-07-17T13:10:00.000Z")).toBe("in about 1 hour");
  });

  it("formats a minutes-scale reset", () => {
    expect(formatRelativeReset("2026-07-17T12:25:00.000Z")).toBe("in 25 minutes");
  });

  it("clamps past or immediate resets to soon", () => {
    expect(formatRelativeReset("2026-07-17T11:59:00.000Z")).toBe("soon");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(formatRelativeReset("not-a-date")).toBeNull();
  });
});
