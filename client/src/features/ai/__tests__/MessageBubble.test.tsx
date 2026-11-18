/**
 * MessageBubble — per-message timestamp (v1.1 Workstream E1).
 *
 * The relative time must be:
 *  - machine-readable: a real <time dateTime=…> element carrying the ISO
 *    timestamp verbatim (ThandiMessage.timestamp, incl. restored threads —
 *    covered end-to-end in useThandiChat.test.tsx's restore tests).
 *  - genuinely reachable by KEYBOARD focus, not hover-only: the bubble that
 *    contains it must be a real tab stop (tabIndex 0), not merely a
 *    group-hover CSS trick that only fires on mouseover.
 *  - visually muted/subtle (not part of the primary reading flow).
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "../components/MessageBubble";
import type { ThandiMessage } from "../types";

const userMessage: ThandiMessage = {
  id: "m1",
  role: "user",
  content: "How much did we spend on groceries?",
  timestamp: "2026-07-17T11:00:00.000Z",
};

const assistantMessage: ThandiMessage = {
  id: "m2",
  role: "assistant",
  content: "K2,145.00 this month.",
  timestamp: "2026-07-17T11:30:00.000Z",
  toolsUsed: ["get_spending_by_category"],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MessageBubble — timestamp (E1)", () => {
  it("renders a machine-readable <time> element carrying the exact ISO timestamp", () => {
    const { container } = render(<MessageBubble message={userMessage} />);

    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("dateTime", userMessage.timestamp);
  });

  it("renders a human-readable relative time as the <time> element's text", () => {
    const { container } = render(<MessageBubble message={userMessage} />);

    const time = container.querySelector("time");
    // 1 hour before the fixed "now" above.
    expect(time?.textContent).toMatch(/1 hour ago/i);
  });

  it("renders the timestamp for assistant messages too", () => {
    const { container } = render(<MessageBubble message={assistantMessage} />);

    const time = container.querySelector("time");
    expect(time).toHaveAttribute("dateTime", assistantMessage.timestamp);
    expect(time?.textContent).toMatch(/30 minutes ago/i);
  });

  it("is muted by default (not styled as primary content)", () => {
    const { container } = render(<MessageBubble message={userMessage} />);

    const time = container.querySelector("time");
    expect(time?.className).toEqual(expect.stringContaining("text-muted-foreground"));
  });

  it("puts the timestamp inside a real keyboard tab stop, not a hover-only affordance", () => {
    const { container } = render(<MessageBubble message={userMessage} />);

    const time = container.querySelector("time");
    // The nearest focusable ancestor must be a genuine tab stop (tabIndex 0),
    // and it must contain the <time> element so :focus-within reveal works
    // for keyboard users exactly as :hover does for mouse users.
    const focusable = container.querySelector('[tabindex="0"]');
    expect(focusable).not.toBeNull();
    expect(focusable?.contains(time)).toBe(true);

    (focusable as HTMLElement).focus();
    expect(document.activeElement).toBe(focusable);
  });

  it("keeps the sender sr-only label and message content unaffected", () => {
    render(<MessageBubble message={userMessage} />);
    expect(screen.getByText("You:")).toBeInTheDocument();
    expect(
      screen.getByText("How much did we spend on groceries?"),
    ).toBeInTheDocument();
  });
});
