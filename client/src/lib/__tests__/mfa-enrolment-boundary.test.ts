/**
 * @vitest-environment jsdom
 *
 * AH-11: a 403 MFA_ENROLMENT_REQUIRED means the session's authority changed
 * (the grace ended), so the client re-reads the session status instead of
 * toasting, and the status reader accepts the new state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createDataQueryClient } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
import { fetchSessionStatus, subscribeSessionInvalidation } from "@/lib/session";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const subject = { id: "11111111-1111-4111-8111-111111111111", email: "member@example.invalid", displayName: null };
const gated = { success: false, error: { code: "MFA_ENROLMENT_REQUIRED", message: "Set up MFA", details: { graceEndedAt: "2026-12-07T10:00:00.000Z" } } };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("AH-11 MFA_ENROLMENT_REQUIRED is a session boundary", () => {
  beforeEach(() => { activateOperationLifetime(createOperationLifetime({ subject: subject.id, household: "22222222-2222-4222-8222-222222222222" })); });
  afterEach(() => { retireOperationLifetime(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("a data query refused for MFA enrolment withdraws the data client without a toast", async () => {
    const onBoundaryError = vi.fn();
    const client = createDataQueryClient(onBoundaryError);
    const failure = Object.assign(new Error("Set up MFA"), { status: 403, code: "MFA_ENROLMENT_REQUIRED" });
    await client.fetchQuery({ queryKey: ["accounts"], queryFn: () => Promise.reject(failure) }).catch(() => undefined);

    expect(onBoundaryError).toHaveBeenCalledWith(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a context-bound request refused for MFA enrolment invalidates the session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(gated, 403)));
    const phases: string[] = [];
    const unsubscribe = subscribeSessionInvalidation(phase => phases.push(phase));
    try {
      await expect(protectedFetch("/api/accounts")).rejects.toMatchObject({ status: 403, code: "MFA_ENROLMENT_REQUIRED" });
    } finally { unsubscribe(); }
    expect(phases).toEqual(["begin", "refresh"]);
  });

  it("the session reader accepts the enrolment-required state", async () => {
    const status = { state: "mfa_enrolment_required", subject, graceEndedAt: "2026-12-07T10:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, data: status })));

    await expect(fetchSessionStatus(new AbortController().signal)).resolves.toEqual(status);
  });
});
