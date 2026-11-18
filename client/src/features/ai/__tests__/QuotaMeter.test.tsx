/**
 * QuotaMeter — subtle low-quota meter (v1.1 Workstream E2).
 *
 * AdviceChat renders this only once remaining questions drop below the
 * threshold; above it the existing plain-text indicator is unchanged
 * (covered in AdviceChat.test.tsx). This file covers the meter itself:
 * accessible progressbar semantics and reuse of formatRelativeReset.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuotaMeter } from "../components/QuotaMeter";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("QuotaMeter", () => {
  it("exposes accessible progressbar semantics reflecting remaining/max", () => {
    render(<QuotaMeter remaining={4} resetTime={null} />);

    const meter = screen.getByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "4");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter.getAttribute("aria-valuemax")).not.toBeNull();
    expect(Number(meter.getAttribute("aria-valuemax"))).toBeGreaterThan(4);
  });

  it("has an accessible name describing what it measures", () => {
    render(<QuotaMeter remaining={4} resetTime={null} />);
    expect(
      screen.getByRole("progressbar", { name: /questions remaining/i }),
    ).toBeInTheDocument();
  });

  it("shows the remaining count in visible copy", () => {
    render(<QuotaMeter remaining={4} resetTime={null} />);
    expect(screen.getByText(/4 questions left today/i)).toBeInTheDocument();
  });

  it("reuses formatRelativeReset for the reset copy instead of reimplementing it", () => {
    render(
      <QuotaMeter remaining={2} resetTime="2026-07-17T15:30:00.000Z" />,
    );
    // formatRelativeReset("2026-07-17T15:30:00.000Z") from a fixed "now" of
    // 12:00:00Z is "in about 4 hours" (relativeReset.test.ts fixture).
    expect(screen.getByText(/in about 4 hours/i)).toBeInTheDocument();
  });

  it("omits reset copy when resetTime is null", () => {
    render(<QuotaMeter remaining={2} resetTime={null} />);
    expect(screen.queryByText(/resets/i)).not.toBeInTheDocument();
  });

  it("handles zero remaining without a negative or NaN width", () => {
    render(<QuotaMeter remaining={0} resetTime={null} />);
    const meter = screen.getByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText(/0 questions left today/i)).toBeInTheDocument();
  });
});
