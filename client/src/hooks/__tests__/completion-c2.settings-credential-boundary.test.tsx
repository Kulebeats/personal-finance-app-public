import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChangePassword } from "../use-settings";
import { useChangeEmail } from "../useSecurity";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { clearCsrfToken } from "@/lib/csrf";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { clearCsrfToken(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); retireOperationLifetime(); vi.unstubAllGlobals(); });
function Draft({ kind }: { kind: "password" | "email" }) {
  const password = useChangePassword(), email = useChangeEmail();
  const [value, setValue] = useState("unsaved draft");
  return <><input aria-label="Draft" value={value} onChange={event => setValue(event.target.value)} />
    <button onClick={() => kind === "password"
      ? password.mutate({ currentPassword: "wrong", newPassword: value, confirmPassword: value })
      : email.mutate({ newEmail: value, password: "wrong" })}>Submit</button></>;
}
describe("C2-SOL-01 actual settings hooks and lifetime MutationCache", () => {
  it.each(["password", "email"] as const)("%s preserves fields on INVALID_CREDENTIALS", async kind => {
    const operation = createOperationLifetime({ subject: "00000000-0000-4000-8000-000000000001" });
    activateOperationLifetime(operation);
    const boundary = vi.fn();
    const client = createDataQueryClient(withdraw => { boundary(withdraw); if (withdraw) { retireDataClient(client); retireOperationLifetime(operation); } }, operation);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token"
      ? json({ csrfToken: "token" }) : json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid password" } }, 401)));
    render(<QueryClientProvider client={client}><Draft kind={kind} /></QueryClientProvider>);
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "preserve this draft" } });
    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => expect(boundary.mock.calls.length > 0 || client.getMutationCache().getAll()[0]?.state.status === "error").toBe(true));
    expect(boundary).not.toHaveBeenCalled(); expect(operation.active).toBe(true);
    expect(screen.getByLabelText("Draft")).toHaveValue("preserve this draft");
    client.clear();
  });
  it("withdraws a genuine expired-session failure through the same password hook", async () => {
    const operation = createOperationLifetime({ subject: "00000000-0000-4000-8000-000000000001" }); activateOperationLifetime(operation);
    const boundary = vi.fn(); const client = createDataQueryClient(boundary, operation);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input) === "/api/csrf-token"
      ? json({ csrfToken: "token" }) : json({ error: { code: "UNAUTHORIZED" } }, 401)));
    render(<QueryClientProvider client={client}><Draft kind="password" /></QueryClientProvider>);
    fireEvent.click(screen.getByText("Submit"));
    await waitFor(() => expect(boundary).toHaveBeenCalledWith(true));
    expect(operation.active).toBe(false); client.clear();
  });
});
