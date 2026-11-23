import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReceipts, useReceipt } from "../useReceipts";
import { useAttachments } from "../useAttachments";
import { useReportWidgetPreferences } from "../use-report-widget-preferences";
import { useWeeklyRecapData } from "@/components/weekly-recap/hooks/useWeeklyRecapData";
import { useReportsExports } from "../use-reports";
import { createDataQueryClient } from "@/lib/queryClient";

const hooks = [
  () => useReceipts(), () => useReceipt("one"), () => useAttachments("one"),
  () => useReportWidgetPreferences(), () => useWeeklyRecapData(), () => useReportsExports(),
];

describe("converted protected reads retain boundary error authority", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it.each(hooks)("propagates structural failure to the boundary from %s", async hook => {
    for (const [status, code] of [[401, "UNAUTHENTICATED"], [403, "EMAIL_VERIFICATION_REQUIRED"], [404, "HOUSEHOLD_NOT_FOUND"]] as const) {
      const boundary = vi.fn(); const client = createDataQueryClient(boundary);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false, error: { code, message: "Authority changed" } }), { status })));
      const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
      const view = renderHook(() => { const query = hook(); return { isError: query.isError, error: query.error }; }, { wrapper });
      await waitFor(() => expect(view.result.current.isError).toBe(true));
      expect(view.result.current.error).toMatchObject({ status, code, message: "Authority changed" });
      expect(boundary).toHaveBeenCalledWith(true);
      view.unmount(); client.clear();
    }
  });
});
