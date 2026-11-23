/**
 * @vitest-environment jsdom
 *
 * CSRF long-tail (§4b): mutating requests embedded in settings-section
 * components must carry x-csrf-token. Each component exports its request
 * function so the header contract is testable without rendering.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  uploadBannerRequest,
  deleteBannerRequest,
} from "../sections/ProfileSection/components/BannerUpload";
import {
  saveSubscription,
  removeSubscription,
} from "../sections/NotificationsSection/PushNotificationSetup";
import { createHousehold } from "../sections/HouseholdSection/components/CreateHouseholdForm";
import { updateHouseholdGeneral } from "../sections/HouseholdSection/components/EditHouseholdForm";
import { updateWeeklyRecapSettings } from "../sections/WeeklyRecapSection";
import { updateAutoRolloverBudget } from "../sections/HouseholdSection/components/BudgetRolloverSetting";

const mockFetch = vi.fn();

const mockFetchResponse = (data: unknown, ok = true): Response =>
  ({
    ok,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(data),
  }) as unknown as Response;

const csrfHeadered = (method: string) =>
  expect.objectContaining({
    method,
    credentials: "include",
    headers: expect.objectContaining({ "x-csrf-token": "test-csrf" }),
  });

describe("settings section mutations attach x-csrf-token", () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/csrf-token")) {
          return Promise.resolve(mockFetchResponse({ csrfToken: "test-csrf" }));
        }
        return mockFetch(input, init);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uploadBannerRequest POSTs FormData with the header and no JSON content-type", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: {} }),
    );

    const file = new File(["x"], "banner.png", { type: "image/png" });
    await uploadBannerRequest(file);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings/profile/banner",
      csrfHeadered("POST"),
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("banner")).toBe(file);
    expect(
      (init.headers as Record<string, string>)["Content-Type"],
    ).toBeUndefined();
  });

  it("deleteBannerRequest DELETEs with the header", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: {} }),
    );

    await deleteBannerRequest();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings/profile/banner",
      csrfHeadered("DELETE"),
    );
  });

  it("saveSubscription POSTs the push subscription with the header", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: {} }),
    );

    const subscription = {
      endpoint: "https://push.example/ep",
      toJSON: () => ({ endpoint: "https://push.example/ep" }),
    } as unknown as PushSubscription;
    await saveSubscription(subscription);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/notifications/push/subscribe",
      csrfHeadered("POST"),
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({ subscription: { endpoint: "https://push.example/ep" } }),
    );
  });

  it("removeSubscription DELETEs the endpoint with the header", async () => {
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: {} }),
    );

    await removeSubscription("https://push.example/ep");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/notifications/push/unsubscribe",
      csrfHeadered("DELETE"),
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(
      JSON.stringify({ endpoint: "https://push.example/ep" }),
    );
  });

  it("createHousehold POSTs with the header and unwraps the envelope", async () => {
    const household = { household: { id: "h1", name: "Casa" } };
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: household }),
    );

    const result = await createHousehold({ name: "Casa", currency: "ZMW" });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/household",
      csrfHeadered("POST"),
    );
    expect(result).toEqual(household);
  });

  it("updateHouseholdGeneral PUTs with the cached token (no manual token round-trip)", async () => {
    const household = { household: { id: "h1", name: "Casa" } };
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: household }),
    );

    const result = await updateHouseholdGeneral({ name: "Casa" });

    // Exactly one non-token request — the old implementation fetched a fresh
    // token inline on every call.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/household/general",
      csrfHeadered("PUT"),
    );
    expect(result).toEqual(household);
  });

  it("updateWeeklyRecapSettings PATCHes with the header and unwraps the envelope", async () => {
    const settings = { enabled: true, emailEnabled: false, dayOfWeek: 0, includeGoals: true, includeRecurring: true };
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: settings }),
    );

    const result = await updateWeeklyRecapSettings({ enabled: true });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/weekly-recap/settings",
      csrfHeadered("PATCH"),
    );
    expect(result).toEqual(settings);
  });

  it("updateAutoRolloverBudget PUTs only the rollover flag with the header", async () => {
    const preferences = { householdId: "h1", autoRolloverBudget: true };
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: { preferences } }),
    );

    const result = await updateAutoRolloverBudget(true);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings/preferences",
      csrfHeadered("PUT"),
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ autoRolloverBudget: true }));
    expect(result).toEqual(preferences);
  });
});
