/**
 * ExportHistory Component
 *
 * Table showing export history for the household
 */

import { Card } from "@/components/ui/card";
import { downloadProtectedResource, reportProtectedMediaError } from "@/lib/protected-media";
import { Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatExportRange } from "../utils/reportFormatters";
import { getReportsExportDownloadUrl } from "@/hooks/use-reports";
import type { ReportsExportItem } from "@shared/reports";

interface ExportHistoryProps {
  exports: ReportsExportItem[];
  isLoading: boolean;
  onClose: () => void;
}

export function ExportHistory({
  exports,
  isLoading,
  onClose,
}: ExportHistoryProps) {
  return (
    <Card className="p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Export history
          </h3>
          <p className="text-xs text-muted-foreground">
            Recent exports for this household.
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading export history...
        </div>
      ) : exports.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase">
              <tr className="border-b border-border">
                <th className="py-2 text-left font-medium">Type</th>
                <th className="py-2 text-left font-medium">Range</th>
                <th className="py-2 text-right font-medium">Records</th>
                <th className="py-2 text-right font-medium">Status</th>
                <th className="py-2 text-right font-medium">Created</th>
                <th className="py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((item) => {
                const createdLabel = new Date(
                  item.createdAt
                ).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });
                const statusClass = cn(
                  "px-2 py-0.5 rounded-full text-xs font-medium",
                  item.status === "completed"
                    ? "bg-emerald-50 text-emerald-700"
                    : item.status === "failed"
                      ? "bg-rose-50 text-rose-700"
                      : "bg-muted/60 text-muted-foreground"
                );

                return (
                  <tr
                    key={item.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="py-2 font-medium">{item.exportType}</td>
                    <td className="py-2 text-muted-foreground">
                      {formatExportRange(
                        item.dateRangeStart,
                        item.dateRangeEnd
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {item.recordCount ?? "--"}
                    </td>
                    <td className="py-2 text-right">
                      <span className={statusClass}>{item.status}</span>
                    </td>
                    <td className="py-2 text-right text-muted-foreground">
                      {createdLabel}
                    </td>
                    <td className="py-2 text-right">
                      {item.status === "completed" && item.id ? (
                        <button
                          onClick={() => {
                            void downloadProtectedResource(getReportsExportDownloadUrl(item.id)).catch(reportProtectedMediaError);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          No exports yet. Use the Export button to generate a report.
        </div>
      )}
    </Card>
  );
}
