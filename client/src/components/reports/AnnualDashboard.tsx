/**
 * AnnualDashboard - Main component for the Annual Dashboard tab
 *
 * Renders all core and optional widgets based on user preferences
 */

import React, { useMemo, Suspense } from "react";
import {
  useReportWidgetPreferences,
  useWidgetToggle,
  useWidgetOnboarding,
  useUpdateReportWidgetPreferences,
  useCustomCharts,
} from "@/hooks/use-report-widget-preferences";
import { useCurrentYearRange } from "@/hooks/use-reports";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { WidgetErrorBoundary } from "./shared/ErrorBoundary";
import AnnualSummaryWidget from "./AnnualSummaryWidget";
import CustomChartWidget from "./CustomChartWidget";
import { CustomizeDashboardModal } from "./CustomizeDashboardModal";
import { CustomChartBuilderModal } from "./CustomChartBuilderModal";
import { Settings2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomChartConfig } from "@shared/reports";
import { AggregationLevel } from "./AggregationFilter";
import { CORE_WIDGETS, OPTIONAL_WIDGETS } from "./AnnualDashboardRegistry";
import { ReportEmptyState } from "@/features/reports/components/ReportEmptyState";

// ============================================================================
// ANNUAL DASHBOARD
// ============================================================================

type AnnualDashboardProps = {
  year?: number;
  className?: string;
};

export function AnnualDashboard({
  year,
  className,
  aggregation = "monthly",
}: AnnualDashboardProps & { aggregation?: AggregationLevel }) {
  const { data: preferences, isLoading: prefsLoading } =
    useReportWidgetPreferences();
  const { toggleWidget } = useWidgetToggle();
  const { resetOnboarding } = useWidgetOnboarding();
  const yearRange = useCurrentYearRange();

  const { customCharts, addCustomChart, updateCustomChart, deleteCustomChart } =
    useCustomCharts();
  const { mutate: updatePreferences } = useUpdateReportWidgetPreferences();

  const [editingChart, setEditingChart] = React.useState<
    CustomChartConfig | undefined
  >(undefined);
  const [isBuilderOpen, setIsBuilderOpen] = React.useState(false);
  const [isCustomizeOpen, setIsCustomizeOpen] = React.useState(false);

  const handleSaveChart = (
    config: Omit<CustomChartConfig, "id" | "createdAt" | "order">,
  ) => {
    if (editingChart) {
      updateCustomChart(editingChart.id, config);
    } else {
      addCustomChart(config);
    }
    setEditingChart(undefined);
  };

  // Compute which widgets to show, sorted by order
  const enabledCoreWidgets = useMemo(() => {
    if (!preferences?.coreWidgets) return Object.keys(CORE_WIDGETS);

    return Object.entries(preferences.coreWidgets)
      .filter(([, config]) => config.enabled)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id)
      .filter((id) => id in CORE_WIDGETS);
  }, [preferences?.coreWidgets]);

  const enabledOptionalWidgets = useMemo(() => {
    // If no preferences exist, default to showing all optional widgets
    if (
      !preferences?.optionalWidgets ||
      Object.keys(preferences.optionalWidgets).length === 0
    ) {
      return Object.keys(OPTIONAL_WIDGETS);
    }

    return Object.entries(preferences.optionalWidgets)
      .filter(([, config]) => config.enabled)
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id)
      .filter((id) => id in OPTIONAL_WIDGETS);
  }, [preferences?.optionalWidgets]);

  if (prefsLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {/* Core Widgets Section */}
      <section>
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-semibold">Overview</h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-2 text-muted-foreground"
              onClick={() => setIsCustomizeOpen(true)}
            >
              <Settings2 className="h-4 w-4" />
              Customize Layout
            </Button>
          </div>
        </div>

        {/* Summary Cards - Full Width Row */}
        {enabledCoreWidgets.includes("summaryCards") && (
          <div className="mb-6">
            <WidgetErrorBoundary widgetId="summaryCards">
              <AnnualSummaryWidget />
            </WidgetErrorBoundary>
          </div>
        )}

        {/* Other Core Widgets - 3 Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {enabledCoreWidgets
            .filter((id) => id !== "summaryCards")
            .map((widgetId) => {
              const Widget = CORE_WIDGETS[widgetId];
              if (!Widget) return null;
              return (
                <WidgetErrorBoundary key={widgetId} widgetId={widgetId}>
                  <Widget
                    onHide={() => toggleWidget("coreWidgets", widgetId, false)}
                    aggregation={aggregation}
                  />
                </WidgetErrorBoundary>
              );
            })}
        </div>
      </section>

      {/* Optional Widgets Section */}
      {enabledOptionalWidgets.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold mb-4">Detailed Analysis</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Suspense fallback={<Skeleton className="h-64 col-span-full" />}>
              {enabledOptionalWidgets.map((widgetId) => {
                const Widget = OPTIONAL_WIDGETS[widgetId];
                if (!Widget) return null;
                return (
                  <WidgetErrorBoundary key={widgetId} widgetId={widgetId}>
                    <Widget
                      onHide={() =>
                        toggleWidget("optionalWidgets", widgetId, false)
                      }
                      aggregation={aggregation}
                    />
                  </WidgetErrorBoundary>
                );
              })}
            </Suspense>
          </div>
        </section>
      )}

      {/* Custom Charts Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Custom Analysis</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsBuilderOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Chart
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customCharts.map((chart) => (
            <WidgetErrorBoundary key={chart.id} widgetId={`custom-${chart.id}`}>
              <CustomChartWidget
                config={chart}
                onEdit={() => {
                  setEditingChart(chart);
                  setIsBuilderOpen(true);
                }}
                onDelete={() => deleteCustomChart(chart.id)}
              />
            </WidgetErrorBoundary>
          ))}
          {customCharts.length === 0 && (
            <div className="col-span-full py-8 text-center border-2 border-dashed rounded-lg">
              <p className="text-muted-foreground mb-2">
                Create custom charts to track specific metrics
              </p>
              <Button variant="ghost" onClick={() => setIsBuilderOpen(true)}>
                Create Chart
              </Button>
            </div>
          )}
        </div>
      </section>

      <CustomChartBuilderModal
        open={isBuilderOpen}
        onOpenChange={(open) => {
          setIsBuilderOpen(open);
          if (!open) setEditingChart(undefined);
        }}
        onSave={handleSaveChart}
        initialConfig={editingChart}
      />

      {preferences && (
        <CustomizeDashboardModal
          open={isCustomizeOpen}
          onOpenChange={setIsCustomizeOpen}
          preferences={preferences}
          onSave={(newPrefs) => updatePreferences(newPrefs)}
          onReset={() => {
            resetOnboarding();
            setIsCustomizeOpen(false);
          }}
          customCharts={customCharts}
          onEditCustomChart={(chart) => {
            setEditingChart(chart);
            setIsBuilderOpen(true);
          }}
          onDeleteCustomChart={deleteCustomChart}
        />
      )}

      {/* Empty State */}
      {enabledCoreWidgets.length === 0 &&
        enabledOptionalWidgets.length === 0 && (
          <ReportEmptyState
            title="Overview Hidden"
            description="All widgets are currently hidden. Use the customize layout button to enable widgets."
            action={
              <Button onClick={() => setIsCustomizeOpen(true)}>
                <Settings2 className="h-4 w-4 mr-2" />
                Customize Layout
              </Button>
            }
          />
        )}
    </div>
  );
}

export default AnnualDashboard;
