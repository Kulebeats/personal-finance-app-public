import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CustomChartConfig } from "@shared/reports";
import { useRef } from "react";
import { useReportPreferenceAction } from "@/hooks/use-report-preference-action";

type CustomizeDashboardCustomTabProps = {
  customCharts: CustomChartConfig[];
  onEditCustomChart: (chart: CustomChartConfig) => void;
  onDeleteCustomChart: (id: string) => Promise<unknown>;
  onClose: () => void;
};

export function CustomizeDashboardCustomTab({
  customCharts,
  onEditCustomChart,
  onDeleteCustomChart,
  onClose,
}: CustomizeDashboardCustomTabProps) {
  const { run, pending, error } = useReportPreferenceAction();
  const retryId = useRef<string>();
  const remove = (id: string) => { retryId.current = id; void run(() => onDeleteCustomChart(id)); };
  return (
    <div className="flex-1 overflow-hidden">
      <p className="text-sm text-muted-foreground mb-4">
        Manage your custom built charts.
      </p>
      <ScrollArea className="h-[calc(100%-40px)] pr-4">
        {customCharts.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            No custom charts created yet.
          </p>
        ) : (
          customCharts.map((chart) => (
            <div
              key={chart.id}
              className="flex items-center justify-between p-3 bg-card border rounded-md mb-2"
            >
              <div>
                <p className="font-medium text-sm">{chart.name}</p>
                <p className="text-xs text-muted-foreground">
                  {chart.primaryMetric} - {chart.chartType}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  disabled={pending}
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    onEditCustomChart(chart);
                    onClose();
                  }}
                  aria-label={`Edit ${chart.name}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  disabled={pending}
                  size="icon"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => remove(chart.id)}
                  aria-label={`Delete ${chart.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </ScrollArea>
      {error && <div><p role="alert">{error}</p><Button disabled={pending} onClick={() => { if (retryId.current) remove(retryId.current); }}>Retry Delete</Button></div>}
    </div>
  );
}
