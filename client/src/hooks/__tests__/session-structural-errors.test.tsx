import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDisplaySettings, useHouseholdMembers, useProfile } from "@/hooks/use-settings";
import { useCategories } from "@/hooks/useCategories";
import { useMfaStatus, useSecurityStatus, useSessions } from "@/hooks/useSecurity";
import { useUnreadCount } from "@/hooks/useNotifications";

describe("session-sensitive fetchers retain structural failures", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it.each([useDisplaySettings, useHouseholdMembers, useProfile, useCategories, useMfaStatus, useSecurityStatus, useSessions, useUnreadCount])("preserves status and code for %s", async hook => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify first" } }), { status: 403 })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => { const query = hook(); return { isError: query.isError, error: query.error }; }, { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 403, code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify first" });
    client.clear();
  });
});
