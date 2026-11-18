/**
 * WidgetGalleryModal - Modal for managing dashboard widgets
 *
 * Allows users to:
 * 1. Enable/Disable core and optional widgets
 * 2. View available widgets
 * 3. Reset to default layout
 */

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LayoutGrid,
  BarChart3,
  TrendingUp,
  PieChart,
  Target,
  CreditCard,
  RefreshCw,
} from "lucide-react";
import {
  useReportWidgetPreferences,
  useWidgetToggle,
} from "@/hooks/use-report-widget-preferences";
import { cn } from "@/lib/utils";

// Widget metadata for display
const WIDGET_INFO: Record<
  string,
  { title: string; description: string; icon: React.ElementType }
> = {
  // Core
  summaryCards: {
    title: "Summary Cards",
    description: "Key metrics for income, expenses, and savings",
    icon: LayoutGrid,
  },
  goalProgress: {
    title: "Goal Progress",
    description: "Track your savings and debt paydown goals",
    icon: Target,
  },
  fixedVariableExpenses: {
    title: "Expense Types",
    description: "Breakdown of fixed vs variable spending",
    icon: PieChart,
  },
  // Optional
  monthlyTrends: {
    title: "Monthly Trends",
    description: "Income and expense trends over time",
    icon: BarChart3,
  },
  cumulativeGrowth: {
    title: "Cumulative Growth",
    description: "Track accumulation of income and savings",
    icon: TrendingUp,
  },
  categoryBreakdown: {
    title: "Category Breakdown",
    description: "Detailed spending by category",
    icon: PieChart,
  },
  financialRatios: {
    title: "Financial Health",
    description: "Key ratios like DTI and emergency fund",
    icon: TrendingUp,
  },
  forecast: {
    title: "Financial Forecast",
    description: "Projected net worth and spending",
    icon: TrendingUp,
  },
  netWorthChanges: {
    title: "Net Worth Changes",
    description: "Monthly changes in net worth",
    icon: TrendingUp,
  },
  debtAnalysis: {
    title: "Debt Overview",
    description: "Breakdown of debt by type and account",
    icon: CreditCard,
  },
};

export function WidgetGalleryModal({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { data: preferences } = useReportWidgetPreferences();
  const { toggleWidget } = useWidgetToggle();
  const [internalOpen, setInternalOpen] = React.useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

  if (!preferences) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Customize Dashboard</DialogTitle>
          <DialogDescription>
            Choose which widgets to display on your annual report.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* Core Widgets */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                Core Metrics
              </h3>
              <div className="space-y-3">
                {Object.entries(preferences.coreWidgets || {})
                  .sort((a, b) => a[1].order - b[1].order)
                  .map(([id, config]) => {
                    const info = WIDGET_INFO[id] || {
                      title: id,
                      description: "Widget",
                      icon: LayoutGrid,
                    };
                    const Icon = info.icon;

                    return (
                      <div
                        key={id}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg border",
                          config.enabled
                            ? "bg-card border-border"
                            : "bg-muted/30 border-transparent"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-md bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{info.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {info.description}
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={config.enabled}
                          onCheckedChange={(checked) =>
                            toggleWidget("coreWidgets", id, checked)
                          }
                        />
                      </div>
                    );
                  })}
              </div>
            </section>

            {/* Optional Widgets */}
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 px-1">
                Detailed Analysis
              </h3>
              <div className="space-y-3">
                {Object.entries(preferences.optionalWidgets || {})
                  .sort((a, b) => a[1].order - b[1].order)
                  .map(([id, config]) => {
                    const info = WIDGET_INFO[id] || {
                      title: id,
                      description: "Widget",
                      icon: LayoutGrid,
                    };
                    const Icon = info.icon;

                    return (
                      <div
                        key={id}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-lg border",
                          config.enabled
                            ? "bg-card border-border"
                            : "bg-muted/30 border-transparent"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-md bg-secondary text-secondary-foreground">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{info.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {info.description}
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={config.enabled}
                          onCheckedChange={(checked) =>
                            toggleWidget("optionalWidgets", id, checked)
                          }
                        />
                      </div>
                    );
                  })}
              </div>
            </section>
          </div>
        </ScrollArea>

        {/* Footer actions */}
        <div className="flex justify-between items-center pt-4 border-t mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled
          >
            <RefreshCw className="h-3 w-3 mr-2" />
            Reset Defaults
          </Button>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
