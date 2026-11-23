import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeeklyRecapSection, { updateWeeklyRecapSettings } from "../WeeklyRecapSection";
import { clearCsrfToken } from "@/lib/csrf";
import { activateOperationLifetime, createOperationLifetime, retireOperationLifetime } from "@/lib/operation-lifetime";
import { createDataQueryClient, retireDataClient } from "@/lib/queryClient";

const { successToast, errorToast } = vi.hoisted(() => ({ successToast: vi.fn(), errorToast: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(successToast, { error: errorToast }) }));

interface Settings {
  enabled: boolean;
  emailEnabled: boolean;
  dayOfWeek: number;
  includeGoals: boolean;
  includeRecurring: boolean;
}
const baseline: Settings = { enabled: true, emailEnabled: true, dayOfWeek: 4, includeGoals: true, includeRecurring: true };
const invalidResponses = [
  ["unsuccessful envelope", { success: false, data: baseline }],
  ["missing data", { success: true }],
  ["missing setting", { success: true, data: { ...baseline, includeGoals: undefined } }],
  ["invalid boolean", { success: true, data: { ...baseline, emailEnabled: "false" } }],
  ["invalid day", { success: true, data: { ...baseline, dayOfWeek: 7 } }],
] as const;
const queryKey = ["weekly-recap-settings"];
const labels = {
  enabled: "Enable Weekly Recap",
  emailEnabled: "Email Digest",
  includeGoals: "Include Goals Progress",
  includeRecurring: "Include Upcoming Bills",
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) };
}

function server(initial = baseline) {
  let stored = { ...initial };
  const read = vi.fn(async () => response({ success: true, data: stored }));
  const write = vi.fn(async (patch: Partial<Settings>) => {
    stored = { ...stored, ...patch };
    return response({ success: true, data: stored });
  });
  const csrf = vi.fn(async () => response({ csrfToken: "recap-csrf" }));
  const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/csrf-token") return csrf();
    if (String(input) === "/api/weekly-recap/settings") {
      if (init?.method === "PATCH") return write(JSON.parse(String(init.body)) as Partial<Settings>);
      return read();
    }
    throw new Error(`Unexpected request: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return { read, write, csrf, fetcher, stored: () => stored, replace: (value: Settings) => { stored = { ...value }; } };
}

const clients: QueryClient[] = [];
function dataClient(subject = "owner-a", warm?: Settings) {
  const operation = createOperationLifetime({ subject, household: "household-one" });
  activateOperationLifetime(operation);
  const client = createDataQueryClient(undefined, operation);
  clients.push(client);
  if (warm) client.setQueryData(queryKey, warm);
  return { client, operation };
}
function mount(warm?: Settings) {
  const identity = dataClient("owner-a", warm);
  const view = render(<QueryClientProvider key={identity.operation.id} client={identity.client}><WeeklyRecapSection /></QueryClientProvider>);
  return { ...view, ...identity };
}
const saveButton = () => screen.getByRole("button", { name: "Save Changes" });
const save = () => fireEvent.click(saveButton());
const toggle = (field: keyof typeof labels) => fireEvent.click(screen.getByRole("switch", { name: labels[field] }));
async function chooseDay(name: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Recap Day" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name }));
}
function expectSettings(settings: Settings) {
  for (const field of Object.keys(labels) as (keyof typeof labels)[]) {
    expect(screen.getByRole("switch", { name: labels[field] })).toHaveAttribute("aria-checked", String(settings[field]));
  }
  expect(screen.getByRole("combobox", { name: "Recap Day" })).toHaveTextContent(
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][settings.dayOfWeek],
  );
}

beforeEach(() => { clearCsrfToken(); successToast.mockReset(); errorToast.mockReset(); });
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) retireDataClient(client);
  retireOperationLifetime();
  vi.unstubAllGlobals();
});

describe("weekly recap preferences persist truthful form state", () => {
  it("waits for delayed settings before offering a save and hydrates every returned field", async () => {
    const api = server();
    const loading = deferred<Response>();
    api.read.mockReturnValueOnce(loading.promise);
    mount();
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    const stored = { enabled: false, emailEnabled: true, dayOfWeek: 6, includeGoals: false, includeRecurring: false };
    await act(async () => loading.resolve(response({ success: true, data: stored })));
    await screen.findByRole("button", { name: "Save Changes" });
    expectSettings(stored);
    save();
    expect(api.write).not.toHaveBeenCalled();
  });

  it("keeps unknown settings unavailable after a failed load and permits a truthful retry", async () => {
    const api = server();
    api.read.mockResolvedValueOnce(response({ error: { code: "UNAVAILABLE", message: "Recap settings unavailable" } }, 503));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unable|unavailable|failed/i);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Save Changes" });
    expectSettings(baseline);
    expect(api.write).not.toHaveBeenCalled();
  });

  it("makes no request for unchanged settings or an edit reverted before saving", async () => {
    const api = server();
    mount(baseline);
    save();
    toggle("emailEnabled");
    toggle("emailEnabled");
    save();
    await act(async () => {});
    expect(api.write).not.toHaveBeenCalled();
    expect(api.csrf).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
  });

  it.each(invalidResponses)("rejects a loaded %s instead of exposing unknown form values", async (_name, payload) => {
    const api = server();
    api.read.mockResolvedValueOnce(response(payload));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid.*settings response/i);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
    expect(api.write).not.toHaveBeenCalled();
  });

  it.each(invalidResponses)("retains the draft and rejects a save's %s without claiming success", async (_name, payload) => {
    const api = server();
    api.write.mockResolvedValueOnce(response(payload));
    const { client } = mount(baseline);
    toggle("emailEnabled");
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid.*settings response/i);
    expectSettings({ ...baseline, emailEnabled: false });
    expect(client.getQueryData(queryKey)).toEqual(baseline);
    expect(successToast).not.toHaveBeenCalled();
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledOnce());
    expect(api.write.mock.calls.map(([patch]) => patch)).toEqual([{ emailEnabled: false }, { emailEnabled: false }]);
  });

  it.each(["enabled", "emailEnabled", "dayOfWeek", "includeGoals", "includeRecurring"] as const)(
    "rejects a shape-valid response contradicting submitted %s and retries the same draft",
    async field => {
      const api = server();
      api.write.mockResolvedValueOnce(response({ success: true, data: baseline }));
      const { client } = mount(baseline);
      if (field === "dayOfWeek") await chooseDay("Sunday");
      else toggle(field);
      const patch = { [field]: field === "dayOfWeek" ? 0 : false };
      save();
      await waitFor(() => expect(successToast.mock.calls.length + errorToast.mock.calls.length).toBeGreaterThan(0));
      await waitFor(() => expect(saveButton()).toBeEnabled());

      expect(successToast).not.toHaveBeenCalled();
      expect(errorToast).toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(/invalid.*settings response/i);
      expect(client.getQueryData(queryKey)).toEqual(baseline);
      expectSettings({ ...baseline, ...patch });
      expect(api.write).toHaveBeenCalledExactlyOnceWith(patch);
      save();
      await waitFor(() => expect(successToast).toHaveBeenCalledOnce());
      expect(api.write.mock.calls.map(([submitted]) => submitted)).toEqual([patch, patch]);
      await waitFor(() => expect(saveButton()).toBeEnabled());
      expectSettings({ ...baseline, ...patch });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      save();
      await act(async () => {});
      expect(api.write).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects partial value acknowledgement without clearing any field from a multi-field draft", async () => {
    const api = server();
    const partlySaved = { ...baseline, emailEnabled: false, dayOfWeek: 0 };
    api.write.mockResolvedValueOnce(response({ success: true, data: partlySaved }));
    const { client } = mount(baseline);
    toggle("emailEnabled");
    toggle("includeGoals");
    await chooseDay("Sunday");
    const patch = { emailEnabled: false, dayOfWeek: 0, includeGoals: false };
    save();
    await waitFor(() => expect(successToast.mock.calls.length + errorToast.mock.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(saveButton()).toBeEnabled());

    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid.*settings response/i);
    expect(client.getQueryData(queryKey)).toEqual(baseline);
    expectSettings({ ...baseline, ...patch });
    expect(api.write).toHaveBeenCalledExactlyOnceWith(patch);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledOnce());
    expect(api.write.mock.calls.map(([submitted]) => submitted)).toEqual([patch, patch]);
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expectSettings({ ...baseline, ...patch });
    save();
    await act(async () => {});
    expect(api.write).toHaveBeenCalledTimes(2);
  });

  it.each([
    { day: 0, label: "Sunday" },
    { day: 6, label: "Saturday" },
  ])("accepts false and day $day while adopting independently changed unsent fields", async ({ day, label }) => {
    const api = server();
    const returned = { enabled: false, emailEnabled: false, dayOfWeek: day, includeGoals: false, includeRecurring: false };
    api.write.mockResolvedValueOnce(response({ success: true, data: returned }));
    const { client } = mount(baseline);
    toggle("emailEnabled");
    await chooseDay(label);
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledOnce());
    await waitFor(() => expect(saveButton()).toBeEnabled());

    expect(api.write).toHaveBeenCalledExactlyOnceWith({ emailEnabled: false, dayOfWeek: day });
    expect(client.getQueryData(queryKey)).toEqual(returned);
    expectSettings(returned);
    expect(errorToast).not.toHaveBeenCalled();
    save();
    await act(async () => {});
    expect(api.write).toHaveBeenCalledOnce();
  });

  it("compares only serialized request fields when optional request properties are undefined", async () => {
    const api = server();
    const returned = { ...baseline, emailEnabled: false, dayOfWeek: 6, includeGoals: false };
    api.write.mockResolvedValueOnce(response({ success: true, data: returned }));
    mount(baseline);

    const saved = await updateWeeklyRecapSettings({ emailEnabled: false, dayOfWeek: undefined, includeGoals: undefined });

    expect(api.write).toHaveBeenCalledExactlyOnceWith({ emailEnabled: false });
    expect(saved).toEqual(returned);
  });

  it.each(["enabled", "emailEnabled", "dayOfWeek", "includeGoals", "includeRecurring"] as const)(
    "saves only %s, preserves omitted fields, and reads the saved value after reload",
    async field => {
      const api = server();
      const view = mount(baseline);
      if (field === "dayOfWeek") await chooseDay("Sunday");
      else toggle(field);
      save();
      await waitFor(() => expect(successToast).toHaveBeenCalledOnce());
      const patch = { [field]: field === "dayOfWeek" ? 0 : false };
      expect(api.write).toHaveBeenCalledExactlyOnceWith(patch);
      const stored = { ...baseline, ...patch };
      expect(api.stored()).toEqual(stored);
      expectSettings(stored);
      const [, init] = api.fetcher.mock.calls.find(([, options]) => options?.method === "PATCH")!;
      const headers = new Headers(init?.headers);
      expect(headers.get("x-csrf-token")).toBe("recap-csrf");
      expect(headers.get("X-Capital-Subject")).toBe("owner-a");
      save();
      await act(async () => {});
      expect(api.write).toHaveBeenCalledTimes(1);
      view.unmount();
      mount();
      await screen.findByRole("button", { name: "Save Changes" });
      expectSettings(stored);
      expect(api.read).toHaveBeenCalledOnce();
    },
  );

  it("keeps drafts after a failed save and retries only the changed fields", async () => {
    const api = server();
    api.write.mockResolvedValueOnce(response({ error: { code: "OFFLINE", message: "Save is temporarily unavailable" } }, 503));
    const { client } = mount(baseline);
    toggle("emailEnabled");
    save();
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
    expectSettings({ ...baseline, emailEnabled: false });
    expect(client.getQueryData(queryKey)).toEqual(baseline);
    expect(successToast).not.toHaveBeenCalled();
    toggle("includeGoals");
    save();
    await waitFor(() => expect(successToast).toHaveBeenCalledOnce());
    expect(api.write.mock.calls.map(([patch]) => patch)).toEqual([
      { emailEnabled: false }, { emailEnabled: false, includeGoals: false },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expectSettings({ ...baseline, emailEnabled: false, includeGoals: false });
  });

  it("merges saved server fields while retaining edits and a baseline revert made during the save", async () => {
    const api = server();
    const pending = deferred<Response>();
    api.write.mockReturnValueOnce(pending.promise);
    const { client } = mount(baseline);
    toggle("emailEnabled");
    save();
    await waitFor(() => expect(api.write).toHaveBeenCalledOnce());
    toggle("emailEnabled"); // Intent returns to the old fetched baseline while false is being saved.
    toggle("includeGoals");
    act(() => client.setQueryData(queryKey, { ...baseline, dayOfWeek: 2 }));
    await waitFor(() => expectSettings({ ...baseline, dayOfWeek: 2, includeGoals: false }));
    const returned = { ...baseline, emailEnabled: false, dayOfWeek: 6, includeRecurring: false };
    await act(async () => pending.resolve(response({ success: true, data: returned })));
    await waitFor(() => expect(saveButton()).toBeEnabled());
    expect(client.getQueryData(queryKey)).toEqual(returned);
    expectSettings({ ...returned, emailEnabled: true, includeGoals: false });
    api.replace(returned);
    save();
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(api.write.mock.calls[1][0]).toEqual({ emailEnabled: true, includeGoals: false });
    await waitFor(() => expect(successToast).toHaveBeenCalledTimes(2));
    save();
    await act(async () => {});
    expect(api.write).toHaveBeenCalledTimes(2);
  });

  it("uses the keyed data-provider remount to discard the previous identity's unsaved draft", async () => {
    const api = server();
    const view = mount(baseline);
    toggle("emailEnabled");
    retireDataClient(view.client);
    retireOperationLifetime(view.operation);
    const nextSettings = { ...baseline, enabled: false, dayOfWeek: 3 };
    api.replace(nextSettings);
    const next = dataClient("owner-b");
    view.rerender(<QueryClientProvider key={next.operation.id} client={next.client}><WeeklyRecapSection /></QueryClientProvider>);
    await screen.findByRole("button", { name: "Save Changes" });
    expectSettings(nextSettings);
    save();
    await act(async () => {});
    expect(api.write).not.toHaveBeenCalled();
  });

  it("the protected client suppresses a retired form mutation before dispatch", async () => {
    const api = server();
    const view = mount(baseline);
    toggle("emailEnabled");
    act(() => {
      save();
      retireDataClient(view.client);
      retireOperationLifetime(view.operation);
      activateOperationLifetime(createOperationLifetime({ subject: "owner-b" }));
    });
    await act(async () => {});
    expect(api.csrf).not.toHaveBeenCalled();
    expect(api.write).not.toHaveBeenCalled();
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
  });

  it("prevents a PATCH after CSRF preparation outlives the originating identity", async () => {
    const api = server();
    const token = deferred<Response>();
    api.csrf.mockReturnValueOnce(token.promise);
    const view = mount(baseline);
    toggle("emailEnabled");
    save();
    await waitFor(() => expect(api.csrf).toHaveBeenCalledOnce());
    retireDataClient(view.client);
    retireOperationLifetime(view.operation);
    const next = dataClient("owner-b", baseline);
    view.rerender(<QueryClientProvider key={next.operation.id} client={next.client}><WeeklyRecapSection /></QueryClientProvider>);
    await act(async () => token.resolve(response({ csrfToken: "retired-token" })));
    expect(api.write).not.toHaveBeenCalled();
    expectSettings(baseline);
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
  });

  it.each([200, 503])("ignores an old identity's late %s save response after a keyed remount", async status => {
    const api = server();
    const pending = deferred<Response>();
    api.write.mockReturnValueOnce(pending.promise);
    const view = mount(baseline);
    toggle("emailEnabled");
    save();
    await waitFor(() => expect(api.write).toHaveBeenCalledOnce());
    retireDataClient(view.client);
    retireOperationLifetime(view.operation);
    const nextSettings = { ...baseline, includeRecurring: false };
    const next = dataClient("owner-b", nextSettings);
    view.rerender(<QueryClientProvider key={next.operation.id} client={next.client}><WeeklyRecapSection /></QueryClientProvider>);
    await act(async () => pending.resolve(response(status === 200
      ? { success: true, data: { ...baseline, emailEnabled: false } }
      : { error: { code: "OFFLINE", message: "Retired save failed" } }, status)));
    expectSettings(nextSettings);
    expect(next.client.getQueryData(queryKey)).toEqual(nextSettings);
    expect(view.client.getQueryData(queryKey)).toBeUndefined();
    expect(successToast).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
