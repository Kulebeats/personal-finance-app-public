/**
 * @vitest-environment jsdom
 *
 * CSRF long-tail (§4b): every mutating request in use-settings.ts must carry
 * the x-csrf-token header. server/app.ts enforces CSRF outside NODE_ENV=test,
 * so a missing header 403s in any real browser session — which is why this
 * table asserts the header on ALL 38 mutating hooks, not a sample.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { personalPreferences } from "./personal-preferences-fixture";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { clearCsrfToken } from "@/lib/api";
import {
  useUpdateProfile,
  useUploadProfilePicture,
  useDeleteProfilePicture,
  useUpdateDisplaySettings,
  useUpdateNotificationPreferences,
  useCreateHousehold,
  useUpdateHousehold,
  useUpdateMemberRole,
  useRemoveMember,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useReorderCategories,
  useSeedCategories,
  useCreateCategoryGroup,
  useUpdateCategoryGroup,
  useArchiveCategoryGroup,
  useRestoreCategoryGroup,
  useReorderCategoryGroups,
  useAddMerchantAlias,
  useDeleteMerchantAlias,
  useCreateMerchant,
  useUpdateMerchant,
  useDeleteMerchant,
  useUploadMerchantLogo,
  useDeleteMerchantLogo,
  useMergeMerchants,
  useUndoMerchantMerge,
  useSeedMerchants,
  useCreateRule,
  useUpdateRule,
  useDeleteRule,
  useTestRule,
  useReorderRules,
  usePreviewRule,
  useUpdateUserPreferences,
  useUpdateAIConsent,
} from "../use-settings";
import {
  useInviteMember,
  useTransferOwnership,
  useLeaveHousehold,
} from "../use-household-membership";

// Serve the CSRF token fetch transparently so it never consumes per-test
// mocks; everything else is forwarded to mockFetch.
const mockFetch = vi.fn();

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
};

const mockFetchResponse = (data: unknown, ok = true): Response =>
  ({
    ok,
    headers: { get: () => "application/json" },
    json: vi.fn().mockResolvedValue(data),
  }) as unknown as Response;

const testFile = () => new File(["x"], "upload.png", { type: "image/png" });

// Loosely-typed mutation surface so one table drives every hook (test-only).
// Method syntax on purpose: methods are bivariance-checked, so every hook's
// concrete UseMutationResult<TData, TError, TVariables> conforms.
interface MutationLike {
  mutateAsync(args?: unknown): Promise<unknown>;
}

interface MutationCase {
  name: string;
  useHook: () => MutationLike;
  args?: unknown;
  url: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** FormData uploads must NOT get a JSON content-type. */
  formData?: boolean;
}

const CASES: MutationCase[] = [
  // Profile
  {
    name: "useUpdateProfile",
    useHook: useUpdateProfile as () => MutationLike,
    args: { fullName: "Test User" },
    url: "/api/settings/profile",
    method: "PUT",
  },
  {
    name: "useUploadProfilePicture",
    useHook: useUploadProfilePicture as () => MutationLike,
    args: testFile(),
    url: "/api/settings/profile/picture",
    method: "POST",
    formData: true,
  },
  {
    name: "useDeleteProfilePicture",
    useHook: useDeleteProfilePicture as () => MutationLike,
    url: "/api/settings/profile/picture",
    method: "DELETE",
  },
  // Display + notifications
  {
    name: "useUpdateDisplaySettings",
    useHook: useUpdateDisplaySettings as () => MutationLike,
    args: { theme: "dark" },
    url: "/api/settings/display",
    method: "PUT",
  },
  {
    name: "useUpdateNotificationPreferences",
    useHook: useUpdateNotificationPreferences as () => MutationLike,
    args: { preferences: [{ notificationType: "large_transaction", emailEnabled: true }] },
    url: "/api/settings/notifications",
    method: "PUT",
  },
  // Household
  {
    name: "useCreateHousehold",
    useHook: useCreateHousehold as () => MutationLike,
    args: { name: "Casa" },
    url: "/api/household",
    method: "POST",
  },
  {
    name: "useUpdateHousehold",
    useHook: useUpdateHousehold as () => MutationLike,
    args: { name: "Casa" },
    url: "/api/household/general",
    method: "PUT",
  },
  {
    name: "useUpdateMemberRole",
    useHook: useUpdateMemberRole as () => MutationLike,
    args: { userId: "u1", role: "admin" },
    url: "/api/household/members/u1/role",
    method: "PUT",
  },
  {
    name: "useRemoveMember",
    useHook: useRemoveMember as () => MutationLike,
    args: "u1",
    url: "/api/household/members/u1",
    method: "DELETE",
  },
  {
    name: "useInviteMember",
    useHook: useInviteMember as () => MutationLike,
    args: { email: "a@b.c", role: "member" },
    url: "/api/household/invite",
    method: "POST",
  },
  {
    name: "useTransferOwnership",
    useHook: useTransferOwnership as () => MutationLike,
    args: "u1",
    url: "/api/household/transfer-ownership",
    method: "POST",
  },
  {
    name: "useLeaveHousehold",
    useHook: useLeaveHousehold as () => MutationLike,
    args: undefined,
    url: "/api/household/leave",
    method: "POST",
  },
  // Categories
  {
    name: "useCreateCategory",
    useHook: useCreateCategory as () => MutationLike,
    args: { groupId: "g1", name: "Food" },
    url: "/api/categories",
    method: "POST",
  },
  {
    name: "useUpdateCategory",
    useHook: useUpdateCategory as () => MutationLike,
    args: { id: "c1", data: { name: "Food" } },
    url: "/api/categories/c1",
    method: "PUT",
  },
  {
    name: "useDeleteCategory",
    useHook: useDeleteCategory as () => MutationLike,
    args: "c1",
    url: "/api/categories/c1",
    method: "DELETE",
  },
  {
    name: "useReorderCategories",
    useHook: useReorderCategories as () => MutationLike,
    args: [{ id: "c1", displayOrder: 1 }],
    url: "/api/categories/reorder",
    method: "PUT",
  },
  {
    name: "useSeedCategories",
    useHook: useSeedCategories as () => MutationLike,
    url: "/api/categories/seed",
    method: "POST",
  },
  // Category groups
  {
    name: "useCreateCategoryGroup",
    useHook: useCreateCategoryGroup as () => MutationLike,
    args: { name: "Essentials", type: "expenses" },
    url: "/api/categories/groups",
    method: "POST",
  },
  {
    name: "useUpdateCategoryGroup",
    useHook: useUpdateCategoryGroup as () => MutationLike,
    args: { id: "g1", data: { name: "Essentials" } },
    url: "/api/categories/groups/g1",
    method: "PUT",
  },
  {
    name: "useArchiveCategoryGroup",
    useHook: useArchiveCategoryGroup as () => MutationLike,
    args: "g1",
    url: "/api/categories/groups/g1",
    method: "DELETE",
  },
  {
    name: "useRestoreCategoryGroup",
    useHook: useRestoreCategoryGroup as () => MutationLike,
    args: "g1",
    url: "/api/categories/groups/g1/restore",
    method: "PUT",
  },
  {
    name: "useReorderCategoryGroups",
    useHook: useReorderCategoryGroups as () => MutationLike,
    args: [{ id: "g1", displayOrder: 0 }],
    url: "/api/categories/groups/reorder",
    method: "PUT",
  },
  // Merchants
  {
    name: "useAddMerchantAlias",
    useHook: useAddMerchantAlias as () => MutationLike,
    args: { merchantId: "m1", aliasName: "Alias" },
    url: "/api/merchants/m1/aliases",
    method: "POST",
  },
  {
    name: "useDeleteMerchantAlias",
    useHook: useDeleteMerchantAlias as () => MutationLike,
    args: { merchantId: "m1", aliasId: "a1" },
    url: "/api/merchants/m1/aliases/a1",
    method: "DELETE",
  },
  {
    name: "useCreateMerchant",
    useHook: useCreateMerchant as () => MutationLike,
    args: { name: "Shoprite" },
    url: "/api/merchants",
    method: "POST",
  },
  {
    name: "useUpdateMerchant",
    useHook: useUpdateMerchant as () => MutationLike,
    args: { id: "m1", data: { name: "Shoprite" } },
    url: "/api/merchants/m1",
    method: "PUT",
  },
  {
    name: "useDeleteMerchant",
    useHook: useDeleteMerchant as () => MutationLike,
    args: { id: "m1", options: { action: "soft" } },
    url: "/api/merchants/m1?action=soft",
    method: "DELETE",
  },
  {
    name: "useUploadMerchantLogo",
    useHook: useUploadMerchantLogo as () => MutationLike,
    args: { id: "m1", file: testFile() },
    url: "/api/merchants/m1/logo",
    method: "POST",
    formData: true,
  },
  {
    name: "useDeleteMerchantLogo",
    useHook: useDeleteMerchantLogo as () => MutationLike,
    args: "m1",
    url: "/api/merchants/m1/logo",
    method: "DELETE",
  },
  {
    name: "useMergeMerchants",
    useHook: useMergeMerchants as () => MutationLike,
    args: { sourceId: "m1", targetId: "m2" },
    url: "/api/merchants/m1/merge",
    method: "POST",
  },
  {
    name: "useUndoMerchantMerge",
    useHook: useUndoMerchantMerge as () => MutationLike,
    args: "h1",
    url: "/api/merchants/merge/h1/undo",
    method: "POST",
  },
  {
    name: "useSeedMerchants",
    useHook: useSeedMerchants as () => MutationLike,
    url: "/api/merchants/seed",
    method: "POST",
  },
  // Rules
  {
    name: "useCreateRule",
    useHook: useCreateRule as () => MutationLike,
    args: { name: "R", conditions: [], conditionLogic: "all", actions: [] },
    url: "/api/rules",
    method: "POST",
  },
  {
    name: "useUpdateRule",
    useHook: useUpdateRule as () => MutationLike,
    args: { id: "r1", data: { name: "R" } },
    url: "/api/rules/r1",
    method: "PUT",
  },
  {
    name: "useDeleteRule",
    useHook: useDeleteRule as () => MutationLike,
    args: "r1",
    url: "/api/rules/r1",
    method: "DELETE",
  },
  {
    name: "useTestRule",
    useHook: useTestRule as () => MutationLike,
    args: { conditions: [], conditionLogic: "all" },
    url: "/api/rules/preview",
    method: "POST",
  },
  {
    name: "useReorderRules",
    useHook: useReorderRules as () => MutationLike,
    args: ["r1"],
    url: "/api/rules/reorder",
    method: "PUT",
  },
  {
    name: "usePreviewRule",
    useHook: usePreviewRule as () => MutationLike,
    args: { conditions: [], conditionLogic: "all" },
    url: "/api/rules/preview",
    method: "POST",
  },
  // Preferences
  {
    name: "useUpdateUserPreferences",
    useHook: useUpdateUserPreferences as () => MutationLike,
    args: { autoFillTodayDate: true },
    url: "/api/settings/user-preferences",
    method: "PUT",
  },
  {
    name: "useUpdateAIConsent",
    useHook: useUpdateAIConsent as () => MutationLike,
    args: { consentGiven: true, consentVersion: "v2.0" },
    url: "/api/ai/consent",
    method: "POST",
  },
];

describe("use-settings mutations attach x-csrf-token", () => {
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

  it.each(CASES)("$name → $method $url", async ({ name, useHook, args, url, method, formData }) => {
    const display = name === "useUpdateDisplaySettings" ? { settings: {
      userId: "test-user", theme: "dark", currency: "ZMW", locale: "en-ZM",
      timezone: "Africa/Lusaka", numberFormat: "US", dateFormat: "yyyy-MM-dd",
      currencyPosition: "before", firstDayOfWeek: "Monday", viewMode: "comfortable",
      dashboardWidgets: null, createdAt: null, updatedAt: null,
    } } : null;
    mockFetch.mockResolvedValue(
      mockFetchResponse({ success: true, data: display ?? (name === "useUpdateNotificationPreferences" ? { preferences: [{
        id: "notification-preference-1",
        userId: "u1",
        notificationType: "large_transaction",
        inAppEnabled: true,
        emailEnabled: true,
        pushEnabled: false,
        thresholdAmount: null,
        createdAt: "2026-10-31T00:00:00.000Z",
        updatedAt: "2026-10-31T00:00:00.000Z",
      }] } : name === "useUpdateUserPreferences" ? { preferences: personalPreferences() } : {}) }),
    );

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useHook(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(args);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        method,
        credentials: "include",
        headers: expect.objectContaining({ "x-csrf-token": "test-csrf" }),
      }),
    );

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    if (formData) {
      expect(init.body).toBeInstanceOf(FormData);
      expect(headers["Content-Type"]).toBeUndefined();
    } else if (init.body !== undefined) {
      expect(headers["Content-Type"]).toBe("application/json");
    }
  });
});
