import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoginHistoryCard } from "../LoginHistoryCard";
import { SessionsCard } from "../SessionsCard";

const securityHooks = vi.hoisted(() => ({
  useLoginHistory: vi.fn(),
  useSessions: vi.fn(),
  useRevokeSession: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRevokeAllOtherSessions: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("@/hooks/useSecurity", () => securityHooks);

describe("security location rendering", () => {
  it("renders login-history location as escaped text", () => {
    const location = '<img src=x onerror="alert(1)">';
    securityHooks.useLoginHistory.mockReturnValue({
      data: [
        {
          id: "login-1",
          loginTime: "2026-07-05T13:00:00.000Z",
          deviceName: null,
          ipAddress: "203.0.113.7",
          location,
          success: true,
          failureReason: null,
        },
      ],
      isLoading: false,
    });

    const { container } = render(<LoginHistoryCard />);

    expect(container.textContent).toContain(location);
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders active-session location as escaped text", () => {
    const location = '<script>alert("xss")</script>';
    securityHooks.useSessions.mockReturnValue({
      data: [
        {
          id: "session-1",
          deviceName: "Desktop",
          deviceType: "desktop",
          browser: "Chrome",
          os: "Windows",
          ipAddress: "203.0.113.7",
          location,
          isTrusted: false,
          lastActiveAt: "2026-07-05T13:00:00.000Z",
          createdAt: "2026-07-05T12:00:00.000Z",
        },
      ],
      isLoading: false,
    });

    const { container } = render(<SessionsCard />);

    expect(container.textContent).toContain(location);
    expect(container.querySelector("script")).toBeNull();
  });
});
