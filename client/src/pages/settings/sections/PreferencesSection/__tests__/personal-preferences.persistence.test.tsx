import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PreferencesSection from "..";
import { personalEnvelope, personalPreferences } from "@/hooks/__tests__/personal-preferences-fixture";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), api: vi.fn() }));
vi.mock("@/lib/protected-fetch", () => ({ protectedFetch: mocks.fetch }));
vi.mock("@/lib/api", () => ({ apiCall: mocks.api, securityApi: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/use-settings", async original => ({ ...await original<typeof import("@/hooks/use-settings")>(), useAIConsent: () => ({ data: { consentGiven: false }, isLoading: false }), useUpdateAIConsent: () => ({ mutate: vi.fn() }) }));
let client: QueryClient;
function mount(cached = true) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  if (cached) client.setQueryData(["userPreferences"], personalPreferences());
  return render(<QueryClientProvider client={client}><PreferencesSection /></QueryClientProvider>);
}
beforeEach(() => { mocks.fetch.mockReset(); mocks.api.mockReset(); });
afterEach(() => { cleanup(); client?.clear(); });

it("does not display fallback controls or write defaults after a failed GET and permits retry", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("Preferences offline")).mockResolvedValueOnce(new Response(JSON.stringify(personalEnvelope())));
  mount(false);
  expect(await screen.findByRole("alert")).toHaveTextContent("Preferences offline");
  expect(screen.queryByRole("switch", { name: "Remember last used account" })).not.toBeInTheDocument();
  expect(mocks.api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry Loading Preferences" }));
  expect(await screen.findByRole("switch", { name: "Remember last used account" })).toBeChecked();
});

it.each([
  ["rememberLastAccount", "Remember last used account", false],
  ["rememberLastCategoryPerMerchant", "Remember category per merchant", false],
  ["autoFillTodayDate", "Auto-fill today's date", false],
  ["skipDuplicateImports", "Skip duplicate transactions", false],
  ["autoAssignCategoriesFromRules", "Auto-assign categories from rules", false],
  ["autoCreateFromReceipt", "Auto-create transactions", true],
  ["requireOcrReview", "Require manual review", false],
] as const)("saves only the edited offered %s field after acknowledgement", async (field, label, value) => {
  mocks.api.mockResolvedValueOnce(personalEnvelope({ [field]: value })); mount();
  fireEvent.click(screen.getByRole("switch", { name: label }));
  fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({ [field]: value });
  await waitFor(() => expect(screen.getByRole("button", { name: "Save Preferences" })).toBeDisabled());
});

it("saves the selected transaction type through the actual select", async () => {
  mocks.api.mockResolvedValueOnce(personalEnvelope({ defaultTransactionType: "income" })); mount();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Default Transaction Type" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: "Income" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({ defaultTransactionType: "income" });
});

it.each([["Home", 0], ["End", 100]] as const)("preserves the full OCR percentage boundary %s=%s", async (key, value) => {
  mocks.api.mockResolvedValueOnce(personalEnvelope({ ocrConfidenceThreshold: value })); mount();
  fireEvent.keyDown(screen.getByRole("slider"), { key });
  fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({ ocrConfidenceThreshold: value });
  await waitFor(() => expect(screen.getByText(`${value}%`)).toBeInTheDocument());
});

it("keeps failed and newer drafts across delayed acknowledgement and refetch", async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.mockRejectedValueOnce(new Error("Save offline")).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce(personalEnvelope());
  mount();
  fireEvent.click(screen.getByRole("switch", { name: "Remember last used account" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save offline");
  expect(screen.getByRole("switch", { name: "Remember last used account" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Retry Save" }));
  fireEvent.click(screen.getByRole("switch", { name: "Remember last used account" }));
  act(() => client.setQueryData(["userPreferences"], personalPreferences()));
  await act(async () => { resolve(personalEnvelope({ rememberLastAccount: false })); });
  expect(screen.getByRole("switch", { name: "Remember last used account" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save Preferences" }));
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
  expect(JSON.parse(mocks.api.mock.calls[2][1].body)).toEqual({ rememberLastAccount: true });
});
