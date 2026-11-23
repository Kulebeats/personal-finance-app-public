/**
 * @vitest-environment jsdom
 *
 * AH-11: backup-code regeneration needs a recent step-up. Its request runs under
 * a 30s deadline, so the step-up prompt must not count against it: a person
 * who takes longer than the deadline to re-authenticate still gets the codes.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearCsrfToken, registerStepUpHandler } from "@/lib/api";
import { CODE_ISSUING_TIMEOUT_MS, useRegenerateBackupCodes } from "@/hooks/useMfaManagement";

const BACKUP_CODES = ["AAAA1111", "BBBB2222", "CCCC3333", "DDDD4444", "EEEE5555", "FFFF6666", "AAAA7777", "BBBB8888"];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let steppedUp = false;
const regenerateCalls: unknown[] = [];

function serve(url: string, init?: RequestInit): Response {
  if (url.includes("/csrf-token")) return json({ csrfToken: "test-csrf" });
  if (url.endsWith("/mfa/backup-codes/regenerate")) {
    regenerateCalls.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    if (!steppedUp) {
      return json({ success: false, requiresStepUp: true, level: "SETTINGS",
        error: { code: "STEP_UP_REQUIRED", message: "Please confirm it's you to continue" } }, 401);
    }
    return json({ success: true, data: { backupCodes: BACKUP_CODES } });
  }
  return json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, 404);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  clearCsrfToken();
  steppedUp = false;
  regenerateCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => serve(String(input), init)));
});
afterEach(() => {
  registerStepUpHandler(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it("a step-up prompt longer than the deadline still ends in the new backup codes", async () => {
  registerStepUpHandler(async () => {
    // The person takes longer than the request deadline to type their password.
    await vi.advanceTimersByTimeAsync(CODE_ISSUING_TIMEOUT_MS + 5_000);
    steppedUp = true;
    return true;
  });
  const { result } = renderHook(() => useRegenerateBackupCodes(), { wrapper });

  await act(async () => {
    await expect(result.current.mutateAsync("246810")).resolves.toEqual(BACKUP_CODES);
  });
  expect(regenerateCalls).toEqual([{ code: "246810" }, { code: "246810" }]);
});

it("a dismissed step-up prompt surfaces the step-up error and sends nothing more", async () => {
  registerStepUpHandler(async () => false);
  const { result } = renderHook(() => useRegenerateBackupCodes(), { wrapper });

  await act(async () => {
    await expect(result.current.mutateAsync("246810")).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });
  });
  expect(regenerateCalls).toHaveLength(1);
});
