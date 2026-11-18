import { describe, it, expect } from "vitest";
import { STEP_UP_TTL } from "../requireStepUp";

describe("STEP_UP_TTL", () => {
  it("uses a 5-minute window for DESTRUCTIVE actions", () => {
    expect(STEP_UP_TTL.DESTRUCTIVE).toBe(5 * 60 * 1000);
  });

  it("keeps FINANCIAL at 5 minutes and SETTINGS at 15 minutes", () => {
    expect(STEP_UP_TTL.FINANCIAL).toBe(5 * 60 * 1000);
    expect(STEP_UP_TTL.SETTINGS).toBe(15 * 60 * 1000);
  });
});
