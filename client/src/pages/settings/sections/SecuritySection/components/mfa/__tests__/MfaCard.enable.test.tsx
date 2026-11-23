/**
 * @vitest-environment jsdom
 *
 * R06.1 enable flow through the real hooks and apiCall, with fetch stubbed at
 * the network boundary: send code -> wrong code shows a clear message ->
 * right code shows backup codes once -> Done only after "I've saved these".
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import { CODE_ISSUING_TIMEOUT_MS } from "@/hooks/useMfaManagement";
import { MfaCard } from "../MfaCard";

const BACKUP_CODES = ["AAAA1111", "BBBB2222", "CCCC3333", "DDDD4444", "EEEE5555", "FFFF6666", "AAAA7777", "BBBB8888"];
const OTP = "246810";
const PASSWORD = "SyntheticPanelPassword1!";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

let mfaEnabled = false;
let hangDisable = false;
/** When set, the enable-confirm request waits until the test calls it. */
let releaseConfirm: (() => void) | null = null;
let holdConfirm = false;
const calls: Array<{ url: string; body: unknown }> = [];

function serve(url: string, init?: RequestInit): Response | Promise<Response> {
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, body });
  if (url.includes("/csrf-token")) return json({ csrfToken: "test-csrf" });
  if (url.endsWith("/mfa/status")) {
    return json({ success: true, data: { mfaEnabled, mfaMethod: mfaEnabled ? "email" : null, backupCodesRemaining: mfaEnabled ? 8 : 0, lowCodesWarning: false } });
  }
  if (url.endsWith("/mfa/enable")) return json({ success: true, data: { codeSent: true, expiresInSeconds: 600 } });
  if (url.endsWith("/mfa/enable/confirm") && holdConfirm && body?.code === OTP) {
    holdConfirm = false;
    return new Promise<Response>((resolve) => {
      releaseConfirm = () => { mfaEnabled = true; resolve(json({ success: true, data: { backupCodes: BACKUP_CODES } })); };
    });
  }
  if (url.endsWith("/mfa/enable/confirm")) {
    if (body?.code !== OTP) {
      return json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "That code is wrong or has expired. Request a new code and try again." } }, 401);
    }
    mfaEnabled = true;
    return json({ success: true, data: { backupCodes: BACKUP_CODES } });
  }
  if (url.endsWith("/mfa/code")) return json({ success: true, data: { codeSent: true, expiresInSeconds: 600 } });
  if (url.endsWith("/mfa/disable")) {
    if (hangDisable) return new Promise<Response>(() => undefined); // never settles, like a stalled network
    if (body?.code !== OTP || body?.password !== PASSWORD) {
      return json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "That password is not correct." } }, 401);
    }
    mfaEnabled = false;
    return json({ success: true, data: null });
  }
  return json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
}

/** Astra P2: no secret may outlive the dialog in React Query's mutation cache. */
async function expectNoSecretsInMutationCache(queryClient: QueryClient) {
  const secrets = [...BACKUP_CODES, OTP, PASSWORD];
  await waitFor(() => {
    const leaked = queryClient.getMutationCache().getAll()
      .map((mutation) => JSON.stringify({ data: mutation.state.data, variables: mutation.state.variables }))
      .filter((state) => secrets.some((secret) => state.includes(secret)));
    expect(leaked).toEqual([]);
  });
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  const { unmount } = render(<MfaCard />, { wrapper });
  return { queryClient, unmount };
}

describe("MfaCard enable flow", () => {
  beforeEach(() => {
    mfaEnabled = false;
    hangDisable = false;
    holdConfirm = false;
    releaseConfirm = null;
    calls.length = 0;
    clearCsrfToken();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => serve(String(input), init)));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("sends a code, refuses a wrong one clearly, then shows backup codes once behind an 'I've saved these' step", async () => {
    const user = userEvent.setup(); // installs a clipboard stub, so spy on it afterwards
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const { queryClient } = renderCard();

    await user.click(await screen.findByRole("button", { name: "Turn on two-step verification" }));
    const dialog = await screen.findByRole("dialog");
    const codeInput = within(dialog).getByLabelText("6-digit code from your email");
    const submit = within(dialog).getByRole("button", { name: "Turn on" });
    expect(submit).toBeDisabled();

    await user.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByRole("button", { name: "Resend code" });
    expect(calls.some((call) => call.url.endsWith("/mfa/enable"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/mfa/enable/confirm"))).toBe(false);

    await user.type(codeInput, "111111");
    await user.click(submit);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That code is wrong or has expired");
    expect(within(dialog).queryByRole("list", { name: "Backup codes" })).toBeNull();

    await user.clear(codeInput);
    await user.type(codeInput, OTP);
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));

    const list = await within(dialog).findByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem").map((item) => item.textContent)).toEqual(BACKUP_CODES);

    await user.click(within(dialog).getByRole("button", { name: "Copy codes" }));
    expect(writeText).toHaveBeenCalledWith(BACKUP_CODES.join("\n"));

    // Escape must not discard codes that will never be shown again.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const done = within(dialog).getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    await user.click(within(dialog).getByLabelText("I've saved these codes somewhere safe"));
    expect(done).toBeEnabled();
    await user.click(done);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("On")).toBeInTheDocument();
    expect(screen.queryByText(BACKUP_CODES[0])).toBeNull();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
    await expectNoSecretsInMutationCache(queryClient);
  });

  it("turning off with password and code leaves neither in the mutation cache", async () => {
    mfaEnabled = true;
    const user = userEvent.setup();
    const { queryClient } = renderCard();

    await user.click(await screen.findByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Current password"), PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByRole("button", { name: "Resend code" });
    expect(calls.find((call) => call.url.endsWith("/mfa/code"))?.body).toEqual({ purpose: "disable" });
    await user.type(within(dialog).getByLabelText("6-digit code from your email"), OTP);
    await user.click(within(dialog).getByRole("button", { name: "Turn off" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Off")).toBeInTheDocument();
    await expectNoSecretsInMutationCache(queryClient);
  });

  it("the dialog can't be closed while the enable-confirm request is pending, so the codes are always shown", async () => {
    holdConfirm = true;
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Turn on two-step verification" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByRole("button", { name: "Resend code" });
    await user.type(within(dialog).getByLabelText("6-digit code from your email"), OTP);
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));

    expect(await within(dialog).findByRole("button", { name: "Checking..." })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    releaseConfirm?.();
    const list = await within(dialog).findByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(BACKUP_CODES.length);
  });

  it("a confirm that never settles releases the lock at the deadline and says the outcome is unknown", async () => {
    holdConfirm = true; // held and never released
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Turn on two-step verification" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByRole("button", { name: "Resend code" });
    await user.type(within(dialog).getByLabelText("6-digit code from your email"), OTP);
    await user.click(within(dialog).getByRole("button", { name: "Turn on" }));
    expect(await within(dialog).findByRole("button", { name: "Cancel" })).toBeDisabled();
    const statusReadsBefore = calls.filter((call) => call.url.endsWith("/mfa/status")).length;

    await act(async () => { vi.advanceTimersByTime(CODE_ISSUING_TIMEOUT_MS + 1); });

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("We couldn't confirm whether this finished");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Create new backup codes");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
    await waitFor(() => expect(calls.filter((call) => call.url.endsWith("/mfa/status")).length).toBeGreaterThan(statusReadsBefore));
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("unmounting during a stalled turn-off request drops the password and code from the cache", async () => {
    mfaEnabled = true;
    hangDisable = true;
    const user = userEvent.setup();
    const { queryClient, unmount } = renderCard();

    await user.click(await screen.findByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Current password"), PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByRole("button", { name: "Resend code" });
    await user.type(within(dialog).getByLabelText("6-digit code from your email"), OTP);
    await user.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await within(dialog).findByRole("button", { name: "Checking..." });

    unmount(); // e.g. navigating away; no close() runs
    await expectNoSecretsInMutationCache(queryClient);
  });

  it("cancelling while the turn-off request is still pending drops the password and code from the cache", async () => {
    mfaEnabled = true;
    hangDisable = true;
    const user = userEvent.setup();
    const { queryClient } = renderCard();

    await user.click(await screen.findByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Current password"), PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Send code" }));
    await within(dialog).findByRole("button", { name: "Resend code" });
    await user.type(within(dialog).getByLabelText("6-digit code from your email"), OTP);
    await user.click(within(dialog).getByRole("button", { name: "Turn off" }));
    await within(dialog).findByRole("button", { name: "Checking..." });
    expect(queryClient.getMutationCache().getAll().some((mutation) => mutation.state.status === "pending")).toBe(true);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expectNoSecretsInMutationCache(queryClient);
  });
});
