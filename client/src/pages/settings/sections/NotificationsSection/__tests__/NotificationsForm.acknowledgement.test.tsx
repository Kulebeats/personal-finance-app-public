import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsForm } from "../NotificationsForm";
import type { NotificationPreference, UpdateNotificationPreferencesData } from "@/hooks/use-settings";
import { clearCsrfToken } from "@/lib/api";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { createDataQueryClient } from "@/lib/queryClient";

const { successToast, errorToast } = vi.hoisted(() => ({ successToast: vi.fn(), errorToast: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: successToast, error: errorToast } }));

const row = (notificationType: string, changes: Partial<NotificationPreference> = {}): NotificationPreference => ({
  id: notificationType,
  userId: "owner-a",
  notificationType,
  inAppEnabled: true,
  emailEnabled: false,
  pushEnabled: false,
  thresholdAmount: null,
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
  ...changes,
});
const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});
const acknowledgement = (preferences: unknown) => json({ success: true, data: { preferences } });
const saveButton = () => screen.getByRole("button", { name: "Save notification preferences" });
const save = () => fireEvent.click(saveButton());
const email = () => screen.getByRole("switch", { name: "Enable Large Transactions email notifications" });
const push = () => screen.getByRole("switch", { name: "Enable Large Transactions push notifications" });
const amount = () => screen.getByRole("spinbutton", { name: "Amount threshold for Large Transactions" });
const budgetEmail = () => screen.getByRole("switch", { name: "Enable Budget Warning email notifications" });

let client: QueryClient | undefined;
let initialRows: NotificationPreference[];
let requests: UpdateNotificationPreferencesData[];
let respond: () => Response | Promise<Response>;

async function mount(rows = [row("large_transaction"), row("budget_warning")]) {
  initialRows = rows;
  // Bind the same operation to the protected client and the actual HTTP caller.
  const operation = createOperationLifetime({ subject: "owner-a" });
  activateOperationLifetime(operation);
  client = createDataQueryClient(undefined, operation);
  render(<QueryClientProvider client={client}><NotificationsForm /></QueryClientProvider>);
  await screen.findByRole("button", { name: "Save notification preferences" });
  return client;
}

async function settled() {
  await waitFor(() => expect(successToast.mock.calls.length + errorToast.mock.calls.length).toBeGreaterThan(0));
  await waitFor(() => expect(saveButton()).toBeEnabled());
}

beforeEach(() => {
  successToast.mockReset();
  errorToast.mockReset();
  clearCsrfToken();
  requests = [];
  initialRows = [];
  respond = () => { throw new Error("Unexpected notification PUT"); };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/csrf-token") return json({ csrfToken: "notification-test-csrf" });
    if (url === "/api/settings/notifications" && (init?.method ?? "GET") === "GET") {
      return acknowledgement(initialRows);
    }
    if (url === "/api/settings/notifications" && init?.method === "PUT") {
      requests.push(JSON.parse(String(init.body)) as UpdateNotificationPreferencesData);
      return respond();
    }
    throw new Error(`Unexpected HTTP request: ${init?.method ?? "GET"} ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  client?.clear();
  client = undefined;
  retireOperationLifetime();
  clearCsrfToken();
  vi.unstubAllGlobals();
});

describe("notification save acknowledgements through the real HTTP hook and form", () => {
  const valid = () => row("large_transaction", { emailEnabled: true });
  const invalidResponses: Array<{ name: string; rows: () => unknown }> = [
    { name: "an empty array", rows: () => [] },
    { name: "a missing requested type", rows: () => [row("budget_warning")] },
    { name: "a null row", rows: () => [null] },
    { name: "a row missing its persisted id", rows: () => { const { id, ...rest } = valid(); return [rest]; } },
    { name: "a row missing a channel", rows: () => { const { pushEnabled, ...rest } = valid(); return [rest]; } },
    { name: "a malformed channel", rows: () => [{ ...valid(), pushEnabled: "false" }] },
    { name: "a malformed threshold", rows: () => [{ ...valid(), thresholdAmount: "not-a-decimal" }] },
    { name: "a missing threshold", rows: () => { const { thresholdAmount, ...rest } = valid(); return [rest]; } },
    { name: "a missing timestamp", rows: () => { const { updatedAt, ...rest } = valid(); return [rest]; } },
    { name: "a duplicate requested type", rows: () => [valid(), valid()] },
    { name: "a conflicting duplicate type", rows: () => [valid(), row("large_transaction")] },
    { name: "a row for another subject", rows: () => [row("large_transaction", { userId: "owner-b", emailEnabled: true })] },
    { name: "an unchanged submitted value", rows: () => [row("large_transaction")] },
    { name: "a missing submitted field", rows: () => { const { emailEnabled, ...rest } = valid(); return [rest]; } },
    { name: "a non-boolean submitted field", rows: () => [{ ...valid(), emailEnabled: 1 }] },
    { name: "a malformed extra row", rows: () => [valid(), { notificationType: "legacy_unknown" }] },
    { name: "an extra row for another subject", rows: () => [valid(), row("legacy_unknown", { userId: "owner-b" })] },
  ];

  it.each(invalidResponses)("rejects $name without changing cache or losing the retry draft", async ({ rows }) => {
    const baseline = [row("large_transaction"), row("budget_warning")];
    const cache = await mount(baseline);
    fireEvent.click(email());
    respond = () => acknowledgement(rows());
    save();
    await settled();

    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledTimes(1);
    expect(cache.getQueryData(["notificationPreferences"])).toEqual(baseline);
    expect(email()).toHaveAttribute("data-state", "checked");
    expect(requests).toEqual([{ preferences: [{ notificationType: "large_transaction", emailEnabled: true }] }]);

    respond = () => acknowledgement([valid()]);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    save();
    expect(requests).toHaveLength(2);
  });

  it("retains both pending rows when a batch acknowledges only one", async () => {
    const baseline = [row("large_transaction"), row("budget_warning")];
    const cache = await mount(baseline);
    fireEvent.click(email());
    fireEvent.click(budgetEmail());
    respond = () => acknowledgement([valid()]);
    save();
    await settled();

    expect(successToast).not.toHaveBeenCalled();
    expect(cache.getQueryData(["notificationPreferences"])).toEqual(baseline);
    expect(email()).toHaveAttribute("data-state", "checked");
    expect(budgetEmail()).toHaveAttribute("data-state", "checked");
    respond = () => acknowledgement([row("budget_warning", { emailEnabled: true }), valid()]);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1].preferences).toHaveLength(2);
  });

  it("requires acknowledgement of every submitted channel on the same row", async () => {
    const baseline = [row("large_transaction")];
    const cache = await mount(baseline);
    fireEvent.click(email());
    fireEvent.click(push());
    fireEvent.click(screen.getByRole("switch", { name: "Enable Large Transactions in-app notifications" }));
    respond = () => acknowledgement([valid()]);
    save();
    await settled();

    expect(successToast).not.toHaveBeenCalled();
    expect(cache.getQueryData(["notificationPreferences"])).toEqual(baseline);
    expect(email()).toHaveAttribute("data-state", "checked");
    expect(push()).toHaveAttribute("data-state", "checked");
    respond = () => acknowledgement([row("large_transaction", { emailEnabled: true, pushEnabled: true, inAppEnabled: false })]);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1]).toEqual({ preferences: [{ notificationType: "large_transaction", emailEnabled: true, pushEnabled: true, inAppEnabled: false }] });
  });

  it.each([
    { requested: "0", persisted: "0.00" },
    { requested: "250.5", persisted: "250.50" },
    { requested: null, persisted: null },
  ])("accepts threshold $requested acknowledged as $persisted and clears only that submitted draft", async ({ requested, persisted }) => {
    const legacy = row("legacy_unknown", { thresholdAmount: "99.50" });
    const cache = await mount([row("large_transaction", { thresholdAmount: "10.00" }), legacy]);
    fireEvent.change(amount(), { target: { value: requested ?? "" } });
    const saved = row("large_transaction", { thresholdAmount: persisted });
    respond = () => acknowledgement([saved]);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    expect(requests).toEqual([{ preferences: [{ notificationType: "large_transaction", thresholdAmount: requested }] }]);
    expect(cache.getQueryData(["notificationPreferences"])).toEqual([saved, legacy]);
    expect(errorToast).not.toHaveBeenCalled();
    save();
    expect(requests).toHaveLength(1);
  });

  it.each([
    { name: "a missing submitted threshold", response: () => { const { thresholdAmount, ...rest } = row("large_transaction"); return rest; } },
    { name: "a null threshold for zero", response: () => row("large_transaction", { thresholdAmount: null }) },
    { name: "an unchanged threshold", response: () => row("large_transaction", { thresholdAmount: "10.00" }) },
    { name: "a number instead of the persisted decimal string", response: () => ({ ...row("large_transaction"), thresholdAmount: 0 }) },
  ])("rejects $name and retries the exact zero edit", async ({ response }) => {
    const baseline = [row("large_transaction", { thresholdAmount: "10.00" })];
    const cache = await mount(baseline);
    fireEvent.change(amount(), { target: { value: "0" } });
    respond = () => acknowledgement([response()]);
    save();
    await settled();

    expect(successToast).not.toHaveBeenCalled();
    expect(cache.getQueryData(["notificationPreferences"])).toEqual(baseline);
    expect(amount()).toHaveValue(0);
    respond = () => acknowledgement([row("large_transaction", { thresholdAmount: "0.00" })]);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[1]).toEqual({ preferences: [{ notificationType: "large_transaction", thresholdAmount: "0" }] });
  });

  it("accepts reordered complete rows plus a valid extra row and preserves untouched cache rows", async () => {
    const legacy = row("legacy_unknown");
    const cache = await mount([row("large_transaction", { emailEnabled: true }), row("budget_warning"), legacy]);
    fireEvent.click(email()); // false is an explicit submitted value.
    fireEvent.click(budgetEmail());
    const savedTransaction = row("large_transaction", { emailEnabled: false });
    const savedBudget = row("budget_warning", { emailEnabled: true });
    const extra = row("maturity_reminder");
    respond = () => acknowledgement([extra, savedBudget, savedTransaction]);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    expect(cache.getQueryData(["notificationPreferences"])).toEqual([savedTransaction, savedBudget, legacy, extra]);
    expect(requests[0]).toEqual({ preferences: [
      { notificationType: "large_transaction", emailEnabled: false },
      { notificationType: "budget_warning", emailEnabled: true },
    ] });
    expect(errorToast).not.toHaveBeenCalled();
    save();
    expect(requests).toHaveLength(1);
  });

  it("retains newer in-flight edits after a valid acknowledgement", async () => {
    await mount();
    let resolve!: (response: Response) => void;
    respond = () => new Promise<Response>(done => { resolve = done; });
    fireEvent.click(email());
    save();
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.click(email());
    fireEvent.click(push());
    await act(async () => resolve(acknowledgement([valid()])));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    expect(email()).toHaveAttribute("data-state", "unchecked");
    expect(push()).toHaveAttribute("data-state", "checked");
    respond = () => acknowledgement([row("large_transaction", { emailEnabled: false, pushEnabled: true })]);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(2));
    expect(requests[1]).toEqual({ preferences: [{ notificationType: "large_transaction", emailEnabled: false, pushEnabled: true }] });
  });
});
