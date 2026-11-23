/**
 * @vitest-environment jsdom
 *
 * AH-11 follow-up: the enrolment screen's Sign out button really signs out.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const logout = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/contexts/SessionContext", () => ({ useSession: () => ({ refresh: vi.fn(), actionError: null }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  authApi: { logout },
}));

import { PendingMfaEnrolment } from "../PendingMfaEnrolment";

describe("AH-11 enrolment screen", () => {
  it("signs out when Sign out is pressed", async () => {
    const user = userEvent.setup();
    render(<PendingMfaEnrolment graceEndedAt="2026-12-07T10:00:00.000Z" />);

    await user.click(screen.getByRole("button", { name: /^sign out$/i }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
