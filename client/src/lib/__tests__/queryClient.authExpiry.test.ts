import { describe, it, expect, vi } from "vitest";
import { createDataQueryClient, retireDataClient } from "../queryClient";
import { toast } from "sonner";

function failure(status: number, code?: string) { return Object.assign(new Error("Request denied"), { status, code }); }

describe("per-lifetime session error handling", () => {
  it.each(["query", "mutation"])("withdraws the originating boundary for a real expired-session %s", async kind => {
    const boundary = vi.fn();
    const client = createDataQueryClient(boundary);
    if (kind === "query") await client.fetchQuery({ queryKey: ["accounts"], queryFn: async () => { throw failure(401, "UNAUTHENTICATED"); } }).catch(() => {});
    else await client.getMutationCache().build(client, { mutationFn: async () => { throw failure(401, "UNAUTHENTICATED"); } }).execute(undefined).catch(() => {});
    expect(boundary).toHaveBeenCalledOnce(); client.clear();
  });

  it("does not classify STEP_UP_REQUIRED as session expiry", async () => {
    const boundary = vi.fn(); const client = createDataQueryClient(boundary);
    await client.fetchQuery({ queryKey: ["security"], queryFn: async () => { throw failure(401, "STEP_UP_REQUIRED"); } }).catch(() => {});
    expect(boundary).not.toHaveBeenCalled(); client.clear();
  });

  it("keeps public form failures local without a boundary redirect", async () => {
    const client = createDataQueryClient();
    await client.getMutationCache().build(client, { mutationFn: async () => { throw failure(401, "INVALID_CREDENTIALS"); } }).execute(undefined).catch(() => {});
    expect(client.getMutationCache().getAll()[0].state.error).toMatchObject({ code: "INVALID_CREDENTIALS" }); client.clear();
  });

  it("ignores late failures from a detached client", async () => {
    const boundary = vi.fn(); const client = createDataQueryClient(boundary);
    retireDataClient(client);
    await client.fetchQuery({ queryKey: ["late"], queryFn: async () => { throw failure(401); } }).catch(() => {});
    expect(boundary).not.toHaveBeenCalled(); client.clear();
  });

  it("handles a burst once when withdrawal detaches the original client", async () => {
    const boundary = vi.fn(() => retireDataClient(client));
    const client = createDataQueryClient(boundary);
    await Promise.all(["a", "b"].map(key => client.fetchQuery({ queryKey: [key], queryFn: async () => { throw failure(401); } }).catch(() => {})));
    expect(boundary).toHaveBeenCalledOnce(); client.clear();
  });

  it("revalidates genuine forbidden operations and shows plain copy, not the server text", async () => {
    const boundary = vi.fn(); const display = vi.spyOn(toast, "error"); const client = createDataQueryClient(boundary);
    await client.fetchQuery({ queryKey: ["forbidden"], queryFn: async () => { throw failure(403, "FORBIDDEN"); } }).catch(() => {});
    expect(boundary).toHaveBeenCalledOnce(); expect(display).toHaveBeenCalledWith("Error loading data", { description: "You don't have permission to do this in this household." }); client.clear(); display.mockRestore();
  });

  // UX-01: a public page (e.g. /invite/:code) asks who is signed in; a 401 there means "signed out",
  // which the page shows itself, so it is no "Error loading data" toast. Public form failures still toast.
  it("shows no error toast for a signed-out query on a public page, but still for a public form failure", async () => {
    const display = vi.spyOn(toast, "error"); const client = createDataQueryClient();
    await client.fetchQuery({ queryKey: ["profile"], queryFn: async () => { throw failure(401, "UNAUTHORIZED"); } }).catch(() => {});
    expect(display).not.toHaveBeenCalled();
    await client.getMutationCache().build(client, { mutationFn: async () => { throw failure(401, "INVALID_CREDENTIALS"); } }).execute(undefined).catch(() => {});
    expect(display).toHaveBeenCalledOnce(); expect(display).toHaveBeenCalledWith("Action failed", expect.anything());
    client.clear(); display.mockRestore();
  });

  it("still toasts a public page's non-401 query failure", async () => {
    const display = vi.spyOn(toast, "error"); display.mockClear(); const client = createDataQueryClient();
    await client.fetchQuery({ queryKey: ["public"], queryFn: async () => { throw failure(500, "INTERNAL_ERROR"); } }).catch(() => {});
    expect(display).toHaveBeenCalledOnce(); client.clear(); display.mockRestore();
  });

  it("says a save may not have gone through when a rejected reply carries no code or status", async () => {
    // e.g. the client rejecting a malformed or contradictory success reply (R05 notifications).
    const display = vi.spyOn(toast, "error"); const client = createDataQueryClient();
    await client.getMutationCache().build(client, { mutationFn: async () => { throw new Error("Invalid notification preferences response"); } }).execute(undefined).catch(() => {});
    expect(display).toHaveBeenCalledWith("Action failed", { description: "Your change may not have been saved. Check it and try again." }); client.clear(); display.mockRestore();
  });
});
