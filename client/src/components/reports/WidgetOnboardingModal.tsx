import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { ReportWidgetPreferences, WidgetPreference } from "@shared/reports";
import {
  CORE_WIDGET_METADATA,
  OPTIONAL_WIDGET_METADATA,
} from "./widgetConstants";

interface WidgetOnboardingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (preferences: Partial<ReportWidgetPreferences>) => void;
}

export function WidgetOnboardingModal({
  open,
  onOpenChange,
  onComplete,
}: WidgetOnboardingModalProps) {
  // Initial state: Core widgets enabled, optional disabled
  const [selectedOptionalWidgets, setSelectedOptionalWidgets] = useState<
    Record<string, boolean>
  >({});

  const toggleWidget = (widgetId: string, checked: boolean) => {
    setSelectedOptionalWidgets((prev) => ({
      ...prev,
      [widgetId]: checked,
    }));
  };

  const applyPreset = (preset: "quick" | "detailed" | "complete") => {
    switch (preset) {
      case "quick":
        setSelectedOptionalWidgets({
          monthlyTrends: true,
        });
        break;
      case "detailed":
        setSelectedOptionalWidgets({
          monthlyTrends: true,
          categoryBreakdown: true,
          incomePerMonth: true,
          expensesPerMonth: true,
          debtPerMonth: true,
          netWorthChanges: true,
        });
        break;
      case "complete":
        const all: Record<string, boolean> = {};
        Object.keys(OPTIONAL_WIDGET_METADATA).forEach((key) => {
          all[key] = true;
        });
        setSelectedOptionalWidgets(all);
        break;
    }
  };

  const handleSave = () => {
    // Construct preferences object
    const optionalWidgets: Record<string, WidgetPreference> = {};

    Object.values(OPTIONAL_WIDGET_METADATA).forEach((meta) => {
      optionalWidgets[meta.id] = {
        id: meta.id,
        enabled: selectedOptionalWidgets[meta.id] || false,
        order: meta.defaultOrder,
        chartType: "default", // will be handled by defaults + persistence
      };
    });

    // Core widgets are always enabled
    const coreWidgets: Record<string, WidgetPreference> = {};
    Object.values(CORE_WIDGET_METADATA).forEach((meta) => {
      coreWidgets[meta.id] = {
        id: meta.id,
        enabled: true,
        order: meta.defaultOrder,
        chartType: "default",
      };
    });

    onComplete({
      coreWidgets,
      optionalWidgets,
    });
  };

  const handleSkip = () => {
    // Just close with defaults (which are already set in backend, but we confirm 'setup complete')
    // We pass empty object so the hook just sets hasCompletedWidgetSetup: true
    onComplete({});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Welcome to Your Reports Dashboard</DialogTitle>
          <DialogDescription>
            Choose the widgets you want to see. You can customize this later.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 py-4 flex-1 overflow-hidden">
          {/* Presets */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              variant="outline"
              className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:text-primary border-2"
              onClick={() => applyPreset("quick")}
            >
              <span className="font-semibold">Quick Overview</span>
              <span className="text-xs font-normal text-muted-foreground text-center">
                Summary Cards + Monthly Trends
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:text-primary border-2"
              onClick={() => applyPreset("detailed")}
            >
              <span className="font-semibold">Detailed Analysis</span>
              <span className="text-xs font-normal text-muted-foreground text-center">
                Includes Income, Expense, & Debt details
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto py-4 flex flex-col gap-2 hover:bg-primary/5 hover:text-primary border-2"
              onClick={() => applyPreset("complete")}
            >
              <span className="font-semibold">Complete</span>
              <span className="text-xs font-normal text-muted-foreground text-center">
                Enable all available widgets
              </span>
            </Button>
          </div>

          <div className="h-px bg-border my-2" />

          {/* Widget Selection */}
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6">
              {/* Core Widgets (Read Only) */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Core Widgets (Always Visible)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.values(CORE_WIDGET_METADATA).map((widget) => (
                    <div
                      key={widget.id}
                      className="flex items-start space-x-3 p-3 rounded-md bg-muted/50 border opacity-80"
                    >
                      <Checkbox checked disabled id={widget.id} />
                      <div className="grid gap-1.5 leading-none">
                        <Label
                          htmlFor={widget.id}
                          className="font-medium cursor-default"
                        >
                          {widget.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {widget.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Optional Widgets */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Optional Widgets
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.values(OPTIONAL_WIDGET_METADATA).map((widget) => (
                    <div
                      key={widget.id}
                      className="flex items-start space-x-3 p-3 rounded-md border hover:bg-accent/50 transition-colors"
                    >
                      <Checkbox
                        id={widget.id}
                        checked={selectedOptionalWidgets[widget.id] || false}
                        onCheckedChange={(c) => toggleWidget(widget.id, !!c)}
                      />
                      <div className="grid gap-1.5 leading-none">
                        <Label
                          htmlFor={widget.id}
                          className="font-medium cursor-pointer"
                        >
                          {widget.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {widget.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleSkip}>
            Skip for Now
          </Button>
          <Button onClick={handleSave}>Save & Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
