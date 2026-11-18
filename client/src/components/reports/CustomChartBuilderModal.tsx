/**
 * CustomChartBuilderModal
 *
 * Full-featured modal for creating and editing custom charts.
 * Supports expanded metrics, grouping, types, and aggregation.
 */
import React, { useState, useEffect } from "react";
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
import { CustomChartConfig } from "@shared/reports";
import CustomChartWidget from "./CustomChartWidget"; // For Live Preview
import { ChartTypeSelector } from "./ChartTypeSelector";

interface CustomChartBuilderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (
    config: Omit<CustomChartConfig, "id" | "createdAt" | "order">,
  ) => void;
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
  const [primaryMetric, setPrimaryMetric] = useState<string>("expenses");
  const [secondaryMetric, setSecondaryMetric] = useState<string>("none");
  const [groupBy, setGroupBy] = useState<string>("category");
  const [aggregation, setAggregation] = useState<string>("monthly");
  const [showAverage, setShowAverage] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  // Load initial config
  useEffect(() => {
    if (initialConfig) {
      setName(initialConfig.name);
      setChartType(initialConfig.chartType);
      setPrimaryMetric(initialConfig.primaryMetric);
      setSecondaryMetric(initialConfig.secondaryMetric || "none");
      setGroupBy(initialConfig.groupBy || "none");
      setAggregation(initialConfig.aggregation || "monthly");
      setShowAverage(initialConfig.showAverage || false);
      setShowComparison(initialConfig.showComparison || false);
    } else {
      // Defaults
      setName("");
      setChartType("bar");
      setPrimaryMetric("expenses");
      setSecondaryMetric("none");
      setGroupBy("category");
      setAggregation("monthly");
      setShowAverage(false);
      setShowComparison(false);
    }
  }, [initialConfig, open]);

  const handleSave = () => {
    onSave({
      name: name || `${primaryMetric} by ${groupBy}`,
      chartType,
      primaryMetric,
      secondaryMetric: secondaryMetric === "none" ? undefined : secondaryMetric,
      groupBy: groupBy === "none" ? undefined : groupBy,
      aggregation,
      showAverage,
      showComparison,
    });
    onOpenChange(false);
  };

  // Live Preview Config
  const previewConfig: CustomChartConfig = {
    id: "preview",
    name: name || "Chart Preview",
    chartType,
    primaryMetric,
    secondaryMetric: secondaryMetric === "none" ? undefined : secondaryMetric,
    groupBy: groupBy === "none" ? undefined : groupBy,
    aggregation,
    showAverage,
    showComparison,
    order: 0,
    createdAt: new Date().toISOString(),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
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
                <Label>Primary Metric</Label>
                <Select value={primaryMetric} onValueChange={setPrimaryMetric}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expenses">Expenses</SelectItem>
                    <SelectItem value="netSavings">Net Savings</SelectItem>
                    <SelectItem value="savingsContributions">
                      Savings Contrib.
                    </SelectItem>
                    <SelectItem value="debt">Debt Payments</SelectItem>
                    <SelectItem value="netWorth">Net Worth</SelectItem>
                    <SelectItem value="netWorthChange">
                      Net Worth Change
                    </SelectItem>
                    <SelectItem value="savingsRate">Savings Rate</SelectItem>
                    <SelectItem value="dti">Debt-to-Income</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Secondary Metric</Label>
                <Select
                  value={secondaryMetric}
                  onValueChange={setSecondaryMetric}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expenses">Expenses</SelectItem>
                    <SelectItem value="savingsContributions">
                      Savings Contrib.
                    </SelectItem>
                    <SelectItem value="debt">Debt Payments</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Group By</Label>
                <Select value={groupBy} onValueChange={setGroupBy}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None (Total)</SelectItem>
                    <SelectItem value="category">Category</SelectItem>
                    <SelectItem value="categoryGroup">
                      Category Group
                    </SelectItem>
                    <SelectItem value="merchant">Merchant</SelectItem>
                    <SelectItem value="account">Account</SelectItem>
                    <SelectItem value="tag">Tag</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Time Aggregation</Label>
                <Select value={aggregation} onValueChange={setAggregation}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="biannual">Bi-Annual</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" onClick={handleSave}>
            Save Chart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
