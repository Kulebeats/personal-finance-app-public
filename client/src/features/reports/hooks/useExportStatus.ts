import { throwIfResNotOk } from "@/lib/queryClient";
import { protectedFetch } from "@/lib/protected-fetch";
import { downloadProtectedResource, reportProtectedMediaError } from "@/lib/protected-media";
import { captureOperationLifetime } from "@/lib/operation-lifetime";
/**
 * useExportStatus Hook
 *
 * Polls export status for progress feedback on long-running exports.
 * Automatically stops polling when export completes or fails.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { ReportsExportItem } from "@shared/reports";

export type ExportStatus = "pending" | "completed" | "failed";

// Simple fetch helper for export status
async function fetchExport(id: string): Promise<ReportsExportItem> {
  const res = await protectedFetch(`/api/reports/exports/${id}`, {
    credentials: "include",
  });
  await throwIfResNotOk(res);

  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Unknown error");
  return json.data;
}

// Simple fetch helper for active exports
async function fetchActiveExports(): Promise<{ exports: ReportsExportItem[] }> {
  const res = await protectedFetch(
    "/api/reports/exports?status=pending&status=processing",
    { credentials: "include" },
  );
  await throwIfResNotOk(res);

  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || "Unknown error");
  return json.data;
}

interface ExportStatusResult {
  export: ReportsExportItem | null;
  status: ExportStatus | null;
  isPolling: boolean;
  isComplete: boolean;
  isFailed: boolean;
  error: Error | null;
}

interface UseExportStatusOptions {
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number;
  /** Whether to show toast notifications (default: true) */
  showToasts?: boolean;
  /** Callback when export completes */
  onComplete?: (exportItem: ReportsExportItem) => void;
  /** Callback when export fails */
  onError?: (error: Error) => void;
}

/**
 * useExportStatus - Poll export status with progress feedback
 *
 * @example
 * const { status, isComplete } = useExportStatus(exportId, {
 *   onComplete: (exp) => console.log("Export ready:", exp),
 * });
 */
export function useExportStatus(
  exportId: string | null | undefined,
  options: UseExportStatusOptions = {},
): ExportStatusResult {
  const {
    pollInterval = 2000,
    showToasts = true,
    onComplete,
    onError,
  } = options;

  const [isPolling, setIsPolling] = useState(false);
  const [hasNotified, setHasNotified] = useState(false);

  const { data, error } = useQuery({
    queryKey: ["reports", "exports", exportId, "status"],
    queryFn: async () => {
      if (!exportId) throw new Error("No export ID provided");
      return fetchExport(exportId);
    },
    enabled: Boolean(exportId) && isPolling,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling when terminal state is reached
      if (data?.status === "completed" || data?.status === "failed") {
        return false;
      }
      return pollInterval;
    },
    staleTime: 0, // Always refetch for status updates
  });

  // Start polling when exportId is set
  useEffect(() => {
    if (exportId) {
      setIsPolling(true);
      setHasNotified(false);
    } else {
      setIsPolling(false);
    }
  }, [exportId]);

  // Handle completion/failure notifications
  useEffect(() => {
    if (!data || hasNotified) return;

    if (data.status === "completed") {
      const operation = captureOperationLifetime();
      setIsPolling(false);
      setHasNotified(true);
      if (showToasts) {
        toast.success("Export ready for download", {
          description: `${data.exportType} export completed`,
          action: {
            label: "Download",
            onClick: () => {
              void downloadProtectedResource(`/api/reports/exports/${data.id}?download=true`, undefined, operation).catch(reportProtectedMediaError);
            },
          },
        });
      }
      onComplete?.(data);
    } else if (data.status === "failed") {
      setIsPolling(false);
      setHasNotified(true);
      if (showToasts) {
        toast.error("Export failed", {
          description: "An error occurred while generating the export",
        });
      }
      onError?.(new Error("Export failed"));
    }
  }, [data, hasNotified, showToasts, onComplete, onError]);

  return {
    export: data ?? null,
    status: (data?.status as ExportStatus) ?? null,
    isPolling,
    isComplete: data?.status === "completed",
    isFailed: data?.status === "failed",
    error: error as Error | null,
  };
}

/**
 * useActiveExports - Track all active/pending exports
 */
export function useActiveExports() {
  return useQuery({
    queryKey: ["reports", "exports", "active"],
    queryFn: fetchActiveExports,
    refetchInterval: 5000,
    staleTime: 0,
  });
}
