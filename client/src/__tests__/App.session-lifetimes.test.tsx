import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "@shared/session-status";
import App from "@/App";
import { beginSessionTransition, invalidateSession } from "@/lib/session";

// Replace the financial leaf only. App, boundary, settings/command providers,
// query caches and profile/API transports are the production implementations.
vi.mock("@/pages/Accounts", async () => {
  const React = await import("react");
  const { useProfile } = await import("@/hooks/use-settings");
  const { useSession } = await import("@/contexts/SessionContext");
  const { apiCall } = await import("@/lib/api");
  return { default: function AccountsProbe() {
    const { data } = useProfile(); const { status, lifetime } = useSession();
    const [draft, setDraft] = React.useState("");
    return <main><h1>Financial account probe</h1><p data-testid="identity">{status && "subject" in status ? status.subject.id : "none"}</p><p data-testid="lifetime">{lifetime?.operation.id}</p><p data-testid="profile">{data?.displayName || "Loading profile"}</p><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} /><button onClick={() => { void apiCall("/accounts", { method: "POST", body: JSON.stringify({ name: draft }) }).catch(() => {}); }}>Save account</button></main>;
  } };
});

const subject = (id: string) => ({ id, email: `${id}@example.test`, displayName: id });
const ready = (id: string, household = "one", role: "owner" | "member" = "owner"): SessionStatus => ({ state: "ready", subject: subject(id), household: { id: household, role } });
const json = (data: unknown) => new Response(JSON.stringify({ success: true, data }));
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
let status: SessionStatus | Error;
let bootstrap: ReturnType<typeof deferred<Response>> | null;
let profile: ReturnType<typeof deferred<Response>> | null;
let probes: number;
let writes: Headers[];

describe("complete App identity and data lifetime transitions", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/accounts"); status = ready("a"); bootstrap = null; profile = null; probes = 0; writes = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/csrf-token") return new Response(JSON.stringify({ csrfToken: "token" }));
      if (url === "/api/accounts" && init?.method === "POST") {
        writes.push(new Headers(init.headers));
        return new Response(JSON.stringify({ error: { code: "SESSION_CONTEXT_CHANGED", message: "Your session context changed. Please submit again." } }), { status: 409 });
      }
      if (url === "/api/auth/session") { probes++; if (bootstrap) return bootstrap.promise; if (status instanceof Error) throw status; return json(status); }
      if (url === "/api/settings/profile") return profile ? profile.promise : json({ profile: { id: status && "subject" in status ? status.subject.id : "unknown", displayName: status && "subject" in status ? status.subject.displayName : "unknown" } });
      if (url === "/api/settings/display") return json({ settings: {} });
      if (url.startsWith("/api/categories")) return json({ categories: [], groups: [] });
      return json([]);
    }));
  });
  afterEach(() => { cleanup(); invalidateSession(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

  it("unchanged focus revalidation preserves the data client and draft", async () => {
    render(<App />); await screen.findByText("Financial account probe");
    const key = screen.getByTestId("lifetime").textContent;
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "keep" } });
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(probes).toBe(2));
    expect(screen.getByTestId("lifetime").textContent).toBe(key);
    expect(screen.getByLabelText("Draft")).toHaveValue("keep");
  });

  it.each([ready("b"), ready("a", "two"), ready("a", "one", "member")])("rotates caches and component state when authority changes to %j", async next => {
    render(<App />); await screen.findByText("Financial account probe");
    const key = screen.getByTestId("lifetime").textContent;
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "old private draft" } });
    status = next; fireEvent(window, new Event("focus"));
    await waitFor(() => expect(screen.getByTestId("lifetime").textContent).not.toBe(key));
    expect(screen.getByLabelText("Draft")).toHaveValue("");
  });

  it("late old-subject profile data never renders in a replacement subject", async () => {
    const oldProfile = deferred<Response>(); profile = oldProfile;
    render(<App />); await screen.findByText("Financial account probe");
    status = ready("b"); profile = null;
    act(() => invalidateSession());
    await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("b"));
    await act(async () => { oldProfile.resolve(json({ profile: { id: "a", displayName: "late-private-a" } })); });
    expect(screen.queryByText("late-private-a")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("profile")).toHaveTextContent("b"));
  });

  it("withdraws protected children immediately during a known auth transition", async () => {
    render(<App />); await screen.findByText("Financial account probe");
    act(() => beginSessionTransition());
    expect(screen.queryByText("Financial account probe")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session");
    expect(probes).toBe(1);
  });

  it("ignores an obsolete bootstrap completion after a newer invalidation", async () => {
    const old = deferred<Response>(); bootstrap = old;
    render(<App />); await waitFor(() => expect(probes).toBe(1));
    bootstrap = null; status = ready("b"); act(() => invalidateSession());
    await screen.findByText("Financial account probe");
    await act(async () => { old.resolve(json(ready("a"))); });
    expect(screen.getByTestId("identity")).toHaveTextContent("b");
  });

  it("withdraws finance on membership removal and on a background lookup failure", async () => {
    render(<App />); await screen.findByText("Financial account probe");
    status = { state: "verified_without_household", subject: subject("a") }; fireEvent(window, new Event("focus"));
    await screen.findByRole("heading", { name: /create your household/i });
    expect(screen.queryByText("Financial account probe")).not.toBeInTheDocument();
    status = new Error("Status database unavailable"); fireEvent(window, new Event("focus"));
    await screen.findByText("Status database unavailable");
    expect(screen.queryByRole("button", { name: "Create Household" })).not.toBeInTheDocument();
  });

  it("rebootstraps without replay after an unsignalled cookie replacement rejects an old form", async () => {
    render(<App />); await screen.findByText("Financial account probe");
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "A private payload" } });
    // The browser cookie changed in another tab; deliberately deliver no signal.
    status = ready("b");
    fireEvent.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("b"));
    expect(screen.getByRole("alert")).toHaveTextContent("Please submit again");
    expect(screen.getByLabelText("Draft")).toHaveValue("");
    expect(writes).toHaveLength(1);
    expect(writes[0].get("X-Capital-Subject")).toBe("a");
    expect(writes[0].get("X-Capital-Household")).toBe("one");
  });
});
