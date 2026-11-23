import React, { useState, useEffect } from "react";
import { useReportPreferenceAction } from "@/hooks/use-report-preference-action";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CUSTOM_CHART_PERIODS,
  DEFAULT_CUSTOM_CHART_PERIOD,
  canCompareCustomChartMetrics,
  canGroupCustomChartMetric,
  canUseCustomChartMetric,
  customChartComparison,
  customChartGroup,
  customChartPeriod,
  type CustomChartConfig,
  type CustomChartPeriod,
} from "@shared/reports";
import CustomChartWidget from "./CustomChartWidget"; // For Live Preview
import { ChartTypeSelector } from "./ChartTypeSelector";

const PERIOD_LABELS: Record<CustomChartPeriod, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  biannual: "Every six months",
  annual: "Annual",
};

interface CustomChartBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    config: Omit<CustomChartConfig, "id" | "createdAt" | "order">,
  ) => Promise<unknown>;
  initialConfig?: CustomChartConfig;
}

export function CustomChartBuilderModal({
  open,
  onOpenChange,
  onSave,
  initialConfig,
}: CustomChartBuilderModalProps) {
  // Form State
  const [name, setName] = useState("");
  const [chartType, setChartType] = useState<string>("bar");
  const [primaryMetric, setPrimaryMetric] = useState(initialConfig?.primaryMetric ?? "expenses");
  const [secondaryMetric, setSecondaryMetric] = useState(initialConfig?.secondaryMetric ?? "none");
  const [groupBy, setGroupBy] = useState(initialConfig ? initialConfig.groupBy ?? "none" : "category");
  const [period, setPeriod] = useState<CustomChartPeriod>(() => initialConfig ? customChartPeriod(initialConfig) : DEFAULT_CUSTOM_CHART_PERIOD);
  const [showAverage, setShowAverage] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const { run, pending, error } = useReportPreferenceAction(open);

  // Load initial config
  useEffect(() => {
    if (initialConfig) {
      setName(initialConfig.name);
      setChartType(initialConfig.chartType);
      setPrimaryMetric(initialConfig.primaryMetric);
      setSecondaryMetric(initialConfig.secondaryMetric || "none");
      setGroupBy(initialConfig.groupBy || "none");
      setPeriod(customChartPeriod(initialConfig));
      setShowAverage(initialConfig.showAverage || false);
      setShowComparison(initialConfig.showComparison || false);
    } else {
      // Defaults
      setName("");
      setChartType("bar");
      setPrimaryMetric("expenses");
      setSecondaryMetric("none");
      setGroupBy("category");
      setPeriod(DEFAULT_CUSTOM_CHART_PERIOD);
      setShowAverage(false);
      setShowComparison(false);
    }
  }, [initialConfig, open]);

  const validMetric = canUseCustomChartMetric(primaryMetric);
  const canGroup = canGroupCustomChartMetric(primaryMetric);
  const chartGroup = customChartGroup(primaryMetric, groupBy);
  const canCompare = canCompareCustomChartMetrics(primaryMetric, chartGroup);
  const comparison = customChartComparison(primaryMetric, chartGroup, secondaryMetric);
  const handleSave = () => {
    void run(() => onSave({
      name: name || (chartGroup ? `${primaryMetric} by ${chartGroup}` : primaryMetric),
      chartType,
      primaryMetric,
      secondaryMetric: comparison,
      groupBy: chartGroup,
      period,
      showAverage,
      showComparison,
    }), () => onOpenChange(false));
  };

  // Live Preview Config
  const previewConfig: CustomChartConfig = {
    id: "preview",
    name: name || "Chart Preview",
    chartType,
    primaryMetric,
    secondaryMetric: comparison,
    groupBy: chartGroup,
    period,
    aggregation: initialConfig?.aggregation,
    showAverage,
    showComparison,
    order: 0,
  };

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>
            {initialConfig ? "Edit Custom Chart" : "Create Custom Chart"}
          </DialogTitle>
          <DialogDescription>
            Build your own analysis. Select metrics, grouping, and
            visualization.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={pending} className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
          {/* LEFT: Configuration Form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Chart Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Monthly Eating Out"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="custom-chart-primary">Primary metric</Label>
                <Select value={validMetric ? primaryMetric : ""} onValueChange={setPrimaryMetric}>
                  <SelectTrigger id="custom-chart-primary">
                    <SelectValue placeholder="Select a metric" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expenses">Expenses</SelectItem>
                    <SelectItem value="netSavings">Net Savings</SelectItem>
                    {primaryMetric === "savings" && <SelectItem value="savings">Net Savings (saved)</SelectItem>}
                    <SelectItem value="netWorth">Net Worth</SelectItem>
                    <SelectItem value="savingsRate">Savings Rate</SelectItem>
                  </SelectContent>
                </Select>
                {!validMetric && <p className="text-xs text-muted-foreground">Choose a supported primary metric to preview or save.</p>}
              </div>

              <div className="space-y-2">
                <Label>Secondary Metric</Label>
                <Select
                  value={comparison ?? "none"}
                  disabled={!canCompare}
                  onValueChange={setSecondaryMetric}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expenses">Expenses</SelectItem>
                    <SelectItem value="savings">Net Savings</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="custom-chart-group">Group by</Label>
                <Select value={chartGroup ?? "none"} onValueChange={setGroupBy} disabled={!canGroup}>
                  <SelectTrigger id="custom-chart-group">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (time series)</SelectItem>
                    <SelectItem value="category">Category</SelectItem>
                    <SelectItem value="categoryGroup">
                      Category Group
                    </SelectItem>
                    <SelectItem value="merchant">Merchant</SelectItem>
                    <SelectItem value="merchantCategory">Merchant Category</SelectItem>
                    <SelectItem value="tag">Tag</SelectItem>
                  </SelectContent>
                </Select>
                {!canGroup && validMetric && <p className="text-xs text-muted-foreground">Only income and expenses can be grouped.</p>}
                {canGroup && groupBy !== "none" && !chartGroup && (
                  <p className="text-xs text-muted-foreground">This saved grouping is unavailable. The chart uses a time series.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-chart-period">Time period</Label>
                <Select
                  value={period}
                  disabled={!!chartGroup}
                  onValueChange={value => {
                    const selected = CUSTOM_CHART_PERIODS.find(option => option === value);
                    if (selected) setPeriod(selected);
                  }}
                >
                  <SelectTrigger id="custom-chart-period" aria-describedby={chartGroup ? "custom-chart-group-period" : undefined}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOM_CHART_PERIODS.map(option => (
                      <SelectItem key={option} value={option}>{PERIOD_LABELS[option]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chartGroup && (
                  <p id="custom-chart-group-period" className="text-xs text-muted-foreground">
                    Grouped charts use the whole date range.
                  </p>
                )}
              </div>
            </div>

            <ChartTypeSelector value={chartType} onChange={setChartType} />

            <div className="flex items-center space-x-4 pt-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="showAverage"
                  checked={showAverage}
                  onCheckedChange={(c) => setShowAverage(!!c)}
                />
                <Label htmlFor="showAverage" className="text-sm font-normal">
                  Show Average
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="showComparison"
                  checked={showComparison}
                  onCheckedChange={(c) => setShowComparison(!!c)}
                />
                <Label htmlFor="showComparison" className="text-sm font-normal">
                  vs Last Year
                </Label>
              </div>
            </div>
          </div>

          {/* RIGHT: Live Preview */}
          <div className="border rounded-lg p-4 bg-muted/10 flex flex-col">
            <Label className="mb-2 text-muted-foreground">Live Preview</Label>
            <div className="flex-1 bg-card rounded-md border shadow-sm p-2 flex flex-col justify-center min-h-[300px]">
              {/* We render the actual widget here with the temporary config */}
              <CustomChartWidget config={previewConfig} />
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Preview based on current year data
            </p>
          </div>
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" onClick={handleSave} disabled={pending || !validMetric}>
            {pending ? "Saving…" : error ? "Retry Save" : "Save Chart"}
          </Button>
        </DialogFooter>
        {error && <p role="alert">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
