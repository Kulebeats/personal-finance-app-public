import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSessionStatus } from "../session";
import { isPublicRoute } from "../public-routes";

describe("untrusted session status transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    { state: "ready", household: { id: "one", role: "owner" } },
    { state: "verification_pending" },
    { state: "verified_without_household" },
    { state: "ready", subject: { id: "a", email: "a@example.test", displayName: null }, household: { id: "one", role: "unknown" } },
    { state: "future" },
  ])("does not accept an invalid authority snapshot %j", async data => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data }))));
    await expect(fetchSessionStatus(new AbortController().signal)).rejects.toThrow(/invalid session/i);
  });
  it.each(["/login/extra", "/verify-email/extra", "/auth/verify-email/extra", "/forgot-password/extra", "/reset-password/extra"])("does not classify arbitrary prefix %s as public", path => expect(isPublicRoute(path)).toBe(false));
  it("treats a one-segment invitation link as public, and nothing else under /invite", () => {
    expect(isPublicRoute("/invite/abc123")).toBe(true);
    for (const path of ["/invite", "/invite/", "/invite/abc/extra", "/invitex/abc"]) expect(isPublicRoute(path)).toBe(false);
  });
});
