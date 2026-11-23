import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { NotificationsForm } from "../NotificationsForm";
import { useUpdateNotificationPreferences, type NotificationPreference } from "@/hooks/use-settings";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";

const { mockFetch, mockApiCall, successToast, errorToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockApiCall: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: mockFetch }));
vi.mock("@/lib/api", () => ({ apiCall: mockApiCall, securityApi: {} }));
vi.mock("sonner", () => ({ toast: { success: successToast, error: errorToast } }));

const row = (notificationType: string, changes: Partial<NotificationPreference> = {}): NotificationPreference => ({
  id: notificationType,
  userId: "owner-a",
  notificationType,
  inAppEnabled: true,
  emailEnabled: false,
  pushEnabled: false,
  thresholdAmount: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...changes,
});

let client: QueryClient;
function mount(rows: NotificationPreference[], queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { preferences: rows } }) });
  client = queryClient;
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const view = render(<NotificationsForm />, { wrapper });
  return { ...view, ready: () => screen.findByRole("button", { name: "Save notification preferences" }) };
}
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save notification preferences" }));
const email = () => screen.getByRole("switch", { name: "Enable Large Transactions email notifications" });
const push = () => screen.getByRole("switch", { name: "Enable Large Transactions push notifications" });
const amount = () => screen.getByRole("spinbutton", { name: "Amount threshold for Large Transactions" });

beforeEach(() => {
  mockFetch.mockReset(); mockApiCall.mockReset(); successToast.mockReset(); errorToast.mockReset();
});
afterEach(() => { client?.clear(); retireOperationLifetime(); });

describe("notification preference partial saves", () => {
  it("submits only changed fields on visible rows and preserves untouched legacy rows in cache", async () => {
    const legacy = row("legacy_unknown", { emailEnabled: true });
    mount([row("large_transaction"), row("budget_warning"), legacy]);
    await screen.findByRole("button", { name: "Save notification preferences" });
    save();
    expect(mockApiCall).not.toHaveBeenCalled();
    fireEvent.click(email());
    fireEvent.click(email());
    save();
    expect(mockApiCall).not.toHaveBeenCalled();

    fireEvent.click(email());
    mockApiCall.mockResolvedValueOnce({ data: { preferences: [row("large_transaction", { emailEnabled: true })] } });
    save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockApiCall.mock.calls[0][1].body)).toEqual({ preferences: [{ notificationType: "large_transaction", emailEnabled: true }] });
    await waitFor(() => expect(client.getQueryData<NotificationPreference[]>(["notificationPreferences"])?.find(pref => pref.notificationType === "large_transaction")?.emailEnabled).toBe(true));
    expect(client.getQueryData<NotificationPreference[]>(["notificationPreferences"])).toContainEqual(legacy);
    expect(client.getQueryData<NotificationPreference[]>(["notificationPreferences"])?.some(pref => pref.notificationType === "budget_warning")).toBe(true);
    save();
    expect(mockApiCall).toHaveBeenCalledTimes(1);
  });

  it("sends explicit null to clear a threshold and preserves zero", async () => {
    mount([row("large_transaction", { thresholdAmount: "10" })]);
    await screen.findByRole("button", { name: "Save notification preferences" });
    fireEvent.change(amount(), { target: { value: "" } });
    mockApiCall.mockResolvedValueOnce({ data: { preferences: [row("large_transaction", { thresholdAmount: null })] } });
    save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockApiCall.mock.calls[0][1].body)).toEqual({ preferences: [{ notificationType: "large_transaction", thresholdAmount: null }] });
    await waitFor(() => expect(amount()).toHaveValue(null));
    fireEvent.change(amount(), { target: { value: "0" } });
    mockApiCall.mockResolvedValueOnce({ data: { preferences: [row("large_transaction", { thresholdAmount: "0" })] } });
    save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockApiCall.mock.calls[1][1].body)).toEqual({ preferences: [{ notificationType: "large_transaction", thresholdAmount: "0" }] });
  });

  it("creates a missing row with only the edited field", async () => {
    mount([]);
    await screen.findByRole("button", { name: "Save notification preferences" });
    fireEvent.click(email());
    mockApiCall.mockResolvedValueOnce({ data: { preferences: [row("large_transaction", { emailEnabled: true })] } });
    save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockApiCall.mock.calls[0][1].body)).toEqual({ preferences: [{ notificationType: "large_transaction", emailEnabled: true }] });
  });

  it("retains newer edits when an older save completes and when cache refreshes", async () => {
    let resolve!: (value: unknown) => void;
    mockApiCall.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    mount([row("large_transaction")]);
    await screen.findByRole("button", { name: "Save notification preferences" });
    fireEvent.click(email());
    save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1));
    fireEvent.click(email()); // newer intent returns to the old fetched value
    fireEvent.click(push());
    act(() => client.setQueryData(["notificationPreferences"], [row("large_transaction")]));
    expect(email()).toHaveAttribute("data-state", "unchecked");
    expect(push()).toHaveAttribute("data-state", "checked");
    await act(async () => resolve({ data: { preferences: [row("large_transaction", { emailEnabled: true })] } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save notification preferences" })).toBeEnabled());
    expect(email()).toHaveAttribute("data-state", "unchecked");
    expect(push()).toHaveAttribute("data-state", "checked");
    mockApiCall.mockResolvedValueOnce({ data: { preferences: [row("large_transaction", { emailEnabled: false, pushEnabled: true })] } });
    save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockApiCall.mock.calls[1][1].body)).toEqual({ preferences: [{ notificationType: "large_transaction", emailEnabled: false, pushEnabled: true }] });
  });

  it("retains drafts after a failed save for a changed-field retry", async () => {
    mount([row("large_transaction")], createDataQueryClient());
    await screen.findByRole("button", { name: "Save notification preferences" });
    fireEvent.click(email());
    mockApiCall.mockRejectedValueOnce(new Error("offline"));
    save();
    await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1));
    fireEvent.click(push());
    mockApiCall.mockResolvedValueOnce({ data: { preferences: [row("large_transaction", { emailEnabled: true, pushEnabled: true })] } });
    save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mockApiCall.mock.calls[1][1].body)).toEqual({ preferences: [{ notificationType: "large_transaction", emailEnabled: true, pushEnabled: true }] });
  });

  it("ignores a late old-identity mutation completion", async () => {
    const oldOperation = createOperationLifetime({ subject: "owner-a" });
    activateOperationLifetime(oldOperation);
    let resolve!: (value: unknown) => void;
    mockApiCall.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    mount([row("large_transaction")]);
    await screen.findByRole("button", { name: "Save notification preferences" });
    fireEvent.click(email()); save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1));
    activateOperationLifetime(createOperationLifetime({ subject: "owner-b" }));
    await act(async () => resolve({ data: { preferences: [row("large_transaction", { emailEnabled: true })] } }));
    expect(client.getQueryData<NotificationPreference[]>(["notificationPreferences"])?.[0]?.emailEnabled).toBe(false);
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("does not show a late old-identity mutation error", async () => {
    const oldOperation = createOperationLifetime({ subject: "owner-a" });
    activateOperationLifetime(oldOperation);
    let reject!: (reason: Error) => void;
    mockApiCall.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    mount([row("large_transaction")], createDataQueryClient(undefined, oldOperation));
    await screen.findByRole("button", { name: "Save notification preferences" });
    fireEvent.click(email()); save();
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(1));
    retireDataClient(client);
    activateOperationLifetime(createOperationLifetime({ subject: "owner-b" }));
    await act(async () => reject(new Error("old session failed")));
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("the protected query client blocks a mutation before dispatch when its lifetime retires", async () => {
    const oldOperation = createOperationLifetime({ subject: "owner-a" });
    activateOperationLifetime(oldOperation);
    client = createDataQueryClient(undefined, oldOperation);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useUpdateNotificationPreferences(), { wrapper });
    let pending!: Promise<NotificationPreference[]>;
    act(() => {
      pending = result.current.mutateAsync({ preferences: [{ notificationType: "large_transaction", emailEnabled: true }] });
      activateOperationLifetime(createOperationLifetime({ subject: "owner-b" }));
    });
    await act(async () => expect(pending).rejects.toThrow(/session changed/i));
    expect(mockApiCall).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("a keyed data provider remount starts the next identity with a fresh draft", async () => {
    const oldOperation = createOperationLifetime({ subject: "owner-a" });
    activateOperationLifetime(oldOperation);
    const oldClient = createDataQueryClient(undefined, oldOperation);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { preferences: [row("large_transaction")] } }) });
    const view = render(<QueryClientProvider key="owner-a" client={oldClient}><NotificationsForm /></QueryClientProvider>);
    await screen.findByRole("button", { name: "Save notification preferences" });
    fireEvent.click(email());
    expect(email()).toHaveAttribute("data-state", "checked");

    retireDataClient(oldClient);
    const nextOperation = createOperationLifetime({ subject: "owner-b" });
    activateOperationLifetime(nextOperation);
    client = createDataQueryClient(undefined, nextOperation);
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: { preferences: [row("large_transaction", { userId: "owner-b" })] } }) });
    view.rerender(<QueryClientProvider key="owner-b" client={client}><NotificationsForm /></QueryClientProvider>);
    await waitFor(() => expect(client.getQueryData<NotificationPreference[]>(["notificationPreferences"])?.[0]?.userId).toBe("owner-b"));
    expect(email()).toHaveAttribute("data-state", "unchecked");
    save();
    expect(mockApiCall).not.toHaveBeenCalled();
  });
});
