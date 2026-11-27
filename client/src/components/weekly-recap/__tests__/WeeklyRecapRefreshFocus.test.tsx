/** @vitest-environment jsdom */
// C3-30 / OPS-007: the recap's periodic access check must keep the focused
// navigation control and the step's own feedback draft, withhold the recap
// figures until access is confirmed, and land on an allowed step after a fresh
// opt-out. Real wizard, real provider, real useWeeklyRecapData on a real
// QueryClient; only transport, formatters and the chart are stubbed.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, focusManager, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WeeklyRecapData } from "@shared/weekly-recap";
import WeeklyRecapWizard from "../WeeklyRecapWizard";

const transport = vi.hoisted(() => ({ recap: vi.fn(), goals: vi.fn(), feedback: vi.fn() }));
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: transport.recap }));
vi.mock("@/lib/api", async original => ({ ...await original<typeof import("@/lib/api")>(), apiCall: transport.feedback }));
vi.mock("@/hooks/useGoals", () => ({
  useGoalsSummary: () => useQuery({ queryKey: ["goals", "summary"], queryFn: transport.goals }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/contexts/SettingsContext", () => ({
  useSettings: () => ({ firstDayOfWeek: "Monday" }),
  useFormatters: () => ({ formatCurrency: (value: number) => `ZMW ${value.toFixed(2)}` }),
}));
vi.mock("../components/WeeklyChart", () => ({ default: () => null }));

function recap(categoryName: string, sections = { goals: true, recurring: true }): WeeklyRecapData {
  return {
    weekStart: "2026-11-16", weekEnd: "2026-11-22", sections,
    netWorth: { current: 900, previous: 800, change: 100, changePercent: 12.5, series: [], trend: "up", currency: "ZMW" },
    spending: { total: 432.1, hasData: true, changePercent: 3, trend: [],
      topCategories: [{ categoryId: "cat-1", name: categoryName, amount: 432.1, percent: 100 }] },
    recurring: { upcoming: [{ id: "bill-1", name: "Synthetic water bill", amount: 75, dueDate: "2026-11-25", frequency: "monthly" }],
      count: 1, totalAmount: 75 },
  } as WeeklyRecapData;
}
const ok = (data: WeeklyRecapData) => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
const denied = () => ({ ok: false, status: 403, statusText: "Forbidden",
  text: async () => JSON.stringify({ error: { message: "Recap access withdrawn", code: "FORBIDDEN" } }) });
const goals = { saveUp: { total: 1, onTrack: 1, totalSaved: "40.00", totalTarget: "80.00" }, payDown: { total: 0, onTrack: 0 } };

let client: QueryClient;
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
const wizard = (queryClient: QueryClient, lifetime = "first") =>
  <QueryClientProvider key={lifetime} client={queryClient}><WeeklyRecapWizard open onOpenChange={vi.fn()} /></QueryClientProvider>;
function mount(data = recap("Synthetic groceries")) {
  transport.recap.mockReset().mockResolvedValue(ok(data));
  client = newClient();
  return render(wizard(client));
}
async function tabTo(user: UserEvent, target: HTMLElement) {
  for (let step = 0; step < 30 && document.activeElement !== target; step += 1) await user.tab();
  expect(document.activeElement).toBe(target);
}
const STEP_HEADINGS = { "net-worth": "Net Worth Update", spending: "Weekly Spending", recurring: "Upcoming Bills", goals: "Goals Progress" };
async function goTo(user: UserEvent, step: keyof typeof STEP_HEADINGS) {
  await user.click(await screen.findByRole("button", { name: "Let's Dive In" }));
  const order = Object.keys(STEP_HEADINGS) as (keyof typeof STEP_HEADINGS)[];
  for (const name of order.slice(0, order.indexOf(step) + 1)) {
    await screen.findByText(STEP_HEADINGS[name]);
    if (name !== step) await user.click(screen.getByRole("button", { name: "Continue" }));
  }
}
/** Start a same-member window-focus recheck whose reply is held until released. */
async function holdRecheck() {
  let release!: (value: ReturnType<typeof ok>) => void;
  const calls = transport.recap.mock.calls.length;
  transport.recap.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
  await waitFor(() => expect(transport.recap.mock.calls.length).toBeGreaterThan(calls));
  await waitFor(() => expect(screen.getAllByText(/Checking current access/i).length).toBeGreaterThan(0));
  return (data: WeeklyRecapData) => act(async () => { release(ok(data)); });
}

beforeEach(() => {
  focusManager.setFocused(undefined);
  transport.goals.mockReset().mockResolvedValue(goals);
  transport.feedback.mockReset().mockResolvedValue({ success: true });
});
afterEach(() => { cleanup(); client?.clear(); focusManager.setFocused(undefined); });

it("keeps the focused Continue control, Close and the feedback draft through a delayed recheck", async () => {
  const user = userEvent.setup();
  mount(); await goTo(user, "spending");
  await screen.findByText("Synthetic groceries");
  await user.click(screen.getByRole("button", { name: "Positive feedback" }));
  const proceed = screen.getByRole("button", { name: "Continue" });
  await tabTo(user, proceed);
  const release = await holdRecheck();
  expect(document.activeElement).toBe(proceed);
  expect(screen.getByRole("button", { name: "Close weekly recap" })).toBeInTheDocument();
  expect(screen.queryByText("Synthetic groceries")).not.toBeInTheDocument();
  expect(screen.queryByText(/432\.10/)).not.toBeInTheDocument();
  await release(recap("Synthetic groceries"));
  await screen.findByText("Synthetic groceries");
  expect(document.activeElement).toBe(proceed);
  expect(screen.getByRole("button", { name: "Positive feedback" })).toHaveAttribute("aria-pressed", "true");
  expect(transport.feedback).toHaveBeenCalledTimes(1);
});

it("withholds goal figures while the recap access check is pending", async () => {
  const user = userEvent.setup();
  mount(); await goTo(user, "goals");
  await screen.findByText("ZMW 40.00");
  const proceed = screen.getByRole("button", { name: "Continue" });
  await tabTo(user, proceed);
  const release = await holdRecheck();
  expect(document.activeElement).toBe(proceed);
  expect(screen.queryByText("ZMW 40.00")).not.toBeInTheDocument();
  await release(recap("Synthetic groceries"));
  await screen.findByText("ZMW 40.00");
  expect(document.activeElement).toBe(proceed);
});

it.each([
  ["recurring", { goals: true, recurring: false }, "Goals Progress", "Weekly Spending"],
  ["goals", { goals: false, recurring: true }, "You're all caught up!", "Upcoming Bills"],
] as const)("moves off the %s step to an allowed step after a fresh opt-out", async (step, sections, landing, previous) => {
  const user = userEvent.setup();
  mount(); await goTo(user, step);
  const release = await holdRecheck();
  await release(recap("Synthetic groceries", sections));
  await screen.findByText(landing);
  expect(screen.queryByText(STEP_HEADINGS[step])).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByText(previous);
  expect(screen.queryByText(STEP_HEADINGS[step])).not.toBeInTheDocument();
});

it("withdraws recap figures and the step draft on an actual revocation", async () => {
  const user = userEvent.setup();
  mount(); await goTo(user, "spending");
  await screen.findByText("Synthetic groceries");
  await user.click(screen.getByRole("button", { name: "Positive feedback" }));
  transport.recap.mockResolvedValue(denied());
  act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
  await screen.findByText(/Unable to refresh your weekly recap/i, undefined, { timeout: 4000 });
  expect(screen.queryByText("Synthetic groceries")).not.toBeInTheDocument();
  transport.recap.mockResolvedValue(ok(recap("Synthetic groceries")));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Synthetic groceries");
  expect(screen.getByRole("button", { name: "Positive feedback" })).not.toHaveAttribute("aria-pressed", "true");
});

it("restarts at the welcome step without the previous member's recap when the session lifetime changes", async () => {
  const user = userEvent.setup();
  const view = mount(); await goTo(user, "spending");
  await screen.findByText("Synthetic groceries");
  await user.click(screen.getByRole("button", { name: "Positive feedback" }));
  transport.recap.mockReset().mockResolvedValue(ok(recap("Next member transport")));
  const previous = client; client = newClient(); previous.clear();
  view.rerender(wizard(client, "second"));
  await screen.findByRole("button", { name: "Let's Dive In" });
  expect(screen.queryByText("Synthetic groceries")).not.toBeInTheDocument();
  expect(screen.queryByText("Weekly Spending")).not.toBeInTheDocument();
});
