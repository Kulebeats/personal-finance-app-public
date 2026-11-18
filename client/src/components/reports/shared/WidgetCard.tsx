/**
 * WidgetCard - Shared widget container for Annual Dashboard
 *
 * Provides consistent styling, loading states, error handling,
 * and chart type switching for all dashboard widgets.
 */

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BarChart3,
  LineChart,
  PieChart,
  AreaChart,
  MoreVertical,
  Settings2,
  Maximize2,
  EyeOff,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ============================================================================
// TYPES
// ============================================================================

export type ChartType =
  | "bar"
  | "line"
  | "area"
  | "donut"
  | "pie"
  | "sankey"
  | "cards"
  | "progressBars"
  | "combo"
  | "stacked_bar"
  | "horizontal_bar"
  | "treemap";

export type WidgetCardProps = {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  isLoading?: boolean;
  error?: Error | null;
  children: React.ReactNode;
  className?: string;

  // Chart type switching
  chartType?: ChartType;
  availableChartTypes?: ChartType[];
  onChartTypeChange?: (type: ChartType) => void;

  // Actions
  onHide?: () => void;
  onExpand?: () => void;
  onSettings?: () => void;

  // Custom Action Slot
  action?: React.ReactNode;

  // Info/Help text
  helpText?: string;
};

// ============================================================================
// CHART TYPE ICONS
// ============================================================================

const chartTypeIcons: Record<ChartType, React.ElementType> = {
  bar: BarChart3,
  line: LineChart,
  area: AreaChart,
  donut: PieChart,
  pie: PieChart,
  sankey: AreaChart,
  cards: BarChart3,
  progressBars: BarChart3,
  combo: AreaChart,
  stacked_bar: BarChart3,
  horizontal_bar: BarChart3,
  treemap: PieChart,
};

const chartTypeLabels: Record<ChartType, string> = {
  bar: "Bar Chart",
  line: "Line Chart",
  area: "Area Chart",
  donut: "Donut Chart",
  pie: "Pie Chart",
  sankey: "Sankey Diagram",
  cards: "Summary Cards",
  progressBars: "Progress Bars",
  combo: "Combo Chart",
  stacked_bar: "Stacked Bar",
  horizontal_bar: "Horizontal Bar",
  treemap: "Treemap",
};

// ============================================================================
// LOADING SKELETON
// ============================================================================

function WidgetSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-8" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

// ============================================================================
// ERROR STATE
// ============================================================================

function WidgetError({ error }: { error: Error }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-center">
      <p className="text-sm text-muted-foreground mb-2">
        Unable to load widget
      </p>
      <p className="text-xs text-destructive">{error.message}</p>
    </div>
  );
}

// ============================================================================
// WIDGET CARD COMPONENT
// ============================================================================

export function WidgetCard({
  title,
  description,
  icon,
  isLoading,
  error,
  children,
  className,
  chartType,
  availableChartTypes,
  onChartTypeChange,
  onHide,
  onExpand,
  onSettings,
  action,
  helpText,
}: WidgetCardProps) {
  const showChartTypeMenu =
    availableChartTypes && availableChartTypes.length > 1 && onChartTypeChange;
  const showActionsMenu = onHide || onExpand || onSettings || showChartTypeMenu;

  return (
    <Card
      className={cn(
        "relative outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      tabIndex={0}
      role="region"
      aria-label={title}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
              {helpText && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground/70 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{helpText}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {action}
          {showActionsMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Widget options</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Chart Type Switcher */}
                {showChartTypeMenu && (
                  <>
                    {availableChartTypes.map((type) => {
                      const Icon = chartTypeIcons[type];
                      const isActive = chartType === type;
                      return (
                        <DropdownMenuItem
                          key={type}
                          onClick={() => onChartTypeChange(type)}
                          className={cn(isActive && "bg-accent")}
                        >
                          <Icon className="mr-2 h-4 w-4" />
                          {chartTypeLabels[type]}
                          {isActive && (
                            <span className="ml-auto text-xs">✓</span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </>
                )}

                {/* Other Actions */}
                {onExpand && (
                  <DropdownMenuItem onClick={onExpand}>
                    <Maximize2 className="mr-2 h-4 w-4" />
                    Expand
                  </DropdownMenuItem>
                )}
                {onSettings && (
                  <DropdownMenuItem onClick={onSettings}>
                    <Settings2 className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                )}
                {onHide && (
                  <DropdownMenuItem
                    onClick={onHide}
                    className="text-destructive"
                  >
                    <EyeOff className="mr-2 h-4 w-4" />
                    Hide Widget
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <WidgetSkeleton />
        ) : error ? (
          <WidgetError error={error} />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// EMPTY STATE
// ============================================================================

export function WidgetEmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-48 text-center">
      {icon && <div className="mb-2 text-muted-foreground">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}
