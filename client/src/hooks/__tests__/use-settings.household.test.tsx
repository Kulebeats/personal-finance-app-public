/**
 * TEST-004: Tests for useHouseholdMembers and useHousehold hooks
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useHousehold,
  useHouseholdMembers,
  useUpdateMemberRole,
  useRemoveMember,
  useCreateHousehold,
  useUpdateHousehold,
} from "../use-settings";
import { ReactNode } from "react";

// Mock fetch globally.
// apiCall() fetches a CSRF token (GET /api/csrf-token) before every mutating
// request. Serve that token transparently so it neither consumes the per-test
// response mock nor shows up in call assertions; all other calls delegate to
// mockFetch exactly as before.
const mockFetch = vi.fn();
global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/csrf-token")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ csrfToken: "test-csrf" }),
    });
  }
  return mockFetch(input, init);
}) as unknown as typeof fetch;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("Household Hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useHousehold", () => {
    it("should fetch household data successfully", async () => {
      const mockHousehold = {
        household: {
          id: "household-1",
          name: "Test Household",
          currency: "USD",
        },
        preferences: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockHousehold }),
      });

      const { result } = renderHook(() => useHousehold(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockHousehold);
    });

    it("should handle fetch error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: "No household found" },
        }),
      });

      const { result } = renderHook(() => useHousehold(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
    });
  });

  describe("useHouseholdMembers", () => {
    it("should fetch household members successfully", async () => {
      const mockMembers = [
        {
          id: "member-1",
          householdId: "household-1",
          userId: "user-1",
          role: "owner",
          joinedAt: "2024-01-01",
          lastActiveAt: null,
          user: {
            id: "user-1",
            username: "owner",
            email: "owner@example.com",
            fullName: "Owner User",
            profilePictureUrl: null,
            lastLoginAt: null,
          },
        },
        {
          id: "member-2",
          householdId: "household-1",
          userId: "user-2",
          role: "member",
          joinedAt: "2024-01-02",
          lastActiveAt: null,
          user: {
            id: "user-2",
            username: "member",
            email: "member@example.com",
            fullName: "Member User",
            profilePictureUrl: null,
            lastLoginAt: null,
          },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { members: mockMembers } }),
      });

      const { result } = renderHook(() => useHouseholdMembers(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockMembers);
      expect(result.current.data).toHaveLength(2);
    });

    it("should handle empty members list", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { members: [] } }),
      });

      const { result } = renderHook(() => useHouseholdMembers(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([]);
    });

    it("should handle fetch error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: "Failed to fetch members" },
        }),
      });

      const { result } = renderHook(() => useHouseholdMembers(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });

    it("should not expose emails to non-admin members (PRIV-001)", async () => {
      const mockMembers = [
        {
          id: "member-1",
          householdId: "household-1",
          userId: "user-1",
          role: "member",
          joinedAt: "2024-01-01",
          lastActiveAt: null,
          user: {
            id: "user-1",
            username: "member",
            email: undefined, // Email filtered out by backend
            fullName: "Member User",
            profilePictureUrl: null,
            lastLoginAt: null,
          },
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { members: mockMembers } }),
      });

      const { result } = renderHook(() => useHouseholdMembers(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.[0]?.user?.email).toBeUndefined();
    });
  });

  describe("useUpdateMemberRole", () => {
    it("should update member role successfully", async () => {
      const mockUpdatedMember = {
        id: "member-1",
        householdId: "household-1",
        userId: "user-1",
        role: "admin",
        joinedAt: "2024-01-01",
        lastActiveAt: null,
        user: null,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { member: mockUpdatedMember },
        }),
      });

      const { result } = renderHook(() => useUpdateMemberRole(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ userId: "user-1", role: "admin" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/household/members/user-1/role",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ role: "admin" }),
        })
      );
    });

    it("should handle role update error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: "Cannot modify your own role" },
        }),
      });

      const { result } = renderHook(() => useUpdateMemberRole(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ userId: "user-1", role: "admin" });

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe("useRemoveMember", () => {
    it("should remove member successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      const { result } = renderHook(() => useRemoveMember(), {
        wrapper: createWrapper(),
      });

      result.current.mutate("user-1");

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/household/members/user-1",
        expect.objectContaining({
          method: "DELETE",
        })
      );
    });

    it("should handle remove error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: { message: "Cannot remove yourself" },
        }),
      });

      const { result } = renderHook(() => useRemoveMember(), {
        wrapper: createWrapper(),
      });

      result.current.mutate("user-1");

      await waitFor(() => expect(result.current.isError).toBe(true));
    });
  });

  describe("useCreateHousehold", () => {
    it("should create household successfully", async () => {
      const mockHousehold = {
        household: {
          id: "household-1",
          name: "New Household",
          currency: "USD",
        },
        preferences: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockHousehold }),
      });

      const { result } = renderHook(() => useCreateHousehold(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ name: "New Household", currency: "USD" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/household",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "New Household", currency: "USD" }),
        })
      );
    });

    it("should handle unicode household name (EDGE-008)", async () => {
      const unicodeName = "🏠 家庭 Famille";
      const mockHousehold = {
        household: {
          id: "household-1",
          name: unicodeName,
          currency: "USD",
        },
        preferences: {},
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockHousehold }),
      });

      const { result } = renderHook(() => useCreateHousehold(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ name: unicodeName, currency: "USD" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });

  describe("useUpdateHousehold", () => {
    it("should update household successfully", async () => {
      const mockUpdatedHousehold = {
        id: "household-1",
        name: "Updated Household",
        currency: "EUR",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { household: mockUpdatedHousehold },
        }),
      });

      const { result } = renderHook(() => useUpdateHousehold(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({
        name: "Updated Household",
        currency: "EUR",
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/household/general",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            name: "Updated Household",
            currency: "EUR",
          }),
        })
      );
    });
  });
});
