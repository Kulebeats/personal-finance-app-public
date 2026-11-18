/**
 * BudgetSettingsModal Component
 *
 * Modal for configuring budget system settings.
 */

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { BudgetSettings, ApplyScope } from "../types";

interface BudgetSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  budgetSystem: "flex" | "category";
  defaultApplyScope: ApplyScope;
  onSaveSettings: (settings: BudgetSettings) => void;
  onRecalculate: () => void;
  onClear: () => void;
  isSaving: boolean;
  isRecalculating: boolean;
  isClearing: boolean;
  onStartWalkthrough?: () => void;
}

export function BudgetSettingsModal({
  isOpen,
  onClose,
  budgetSystem,
  defaultApplyScope,
  onSaveSettings,
  onRecalculate,
  onClear,
  isSaving,
  isRecalculating,
  isClearing,
  onStartWalkthrough,
}: BudgetSettingsModalProps) {
  const [localBudgetSystem, setLocalBudgetSystem] = useState<
    "flex" | "category"
  >(budgetSystem);
  const [localApplyScope, setLocalApplyScope] =
    useState<ApplyScope>(defaultApplyScope);

  useEffect(() => {
    setLocalBudgetSystem(budgetSystem);
  }, [budgetSystem]);

  useEffect(() => {
    setLocalApplyScope(defaultApplyScope);
  }, [defaultApplyScope]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSaveSettings({
      budgetSystem: localBudgetSystem,
      defaultApplyScope: localApplyScope,
    });
  };

  const handleRecalculate = () => {
    if (!window.confirm("Recalculate budgets using historical averages?")) {
      return;
    }
    onRecalculate();
  };

  const handleClear = () => {
    if (!window.confirm("Clear all budget values?")) {
      return;
    }
    onClear();
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
      <Card className="w-full max-w-lg bg-card shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">Budget Settings</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 hover:bg-muted rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-8">
          {/* System Section */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-4">
              System
            </h3>
            <div className="space-y-4">
              {/* Flex Budget Option */}
              <div
                className={cn(
                  "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all",
                  localBudgetSystem === "flex"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/30",
                )}
                onClick={() => setLocalBudgetSystem("flex")}
              >
                <div className="mt-1">
                  <div
                    className={cn(
                      "w-4 h-4 rounded-full border flex items-center justify-center",
                      localBudgetSystem === "flex"
                        ? "border-primary"
                        : "border-muted-foreground",
                    )}
                  >
                    {localBudgetSystem === "flex" && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground">
                      Flex Budget
                    </span>
                    <span className="text-[10px] font-bold bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 px-1.5 py-0.5 rounded uppercase">
                      Recommended
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Simplify your budget by focusing on your flexible expense
                    number.
                  </p>
                </div>
              </div>

              {/* Category Budget Option */}
              <div
                className={cn(
                  "flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all",
                  localBudgetSystem === "category"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/30",
                )}
                onClick={() => setLocalBudgetSystem("category")}
              >
                <div className="mt-1">
                  <div
                    className={cn(
                      "w-4 h-4 rounded-full border flex items-center justify-center",
                      localBudgetSystem === "category"
                        ? "border-primary"
                        : "border-muted-foreground",
                    )}
                  >
                    {localBudgetSystem === "category" && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </div>
                </div>
                <div className="flex-1">
                  <span className="font-bold text-foreground">
                    Category Budget
                  </span>
                  <p className="text-sm text-muted-foreground mt-1">
                    Budget every category individually, the traditional way.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Apply Changes To */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-4">
              By default, apply budget changes to
            </h3>
            <RadioGroup
              value={localApplyScope}
              onValueChange={(value) => setLocalApplyScope(value as ApplyScope)}
            >
              <div className="flex items-start space-x-3 mb-4">
                <RadioGroupItem value="this_month" id="month" />
                <Label htmlFor="month" className="font-medium cursor-pointer">
                  <div className="text-foreground">This month only</div>
                  <p className="text-xs text-muted-foreground font-normal mt-1">
                    Your budget changes will only apply to the month you're
                    editing.
                  </p>
                </Label>
              </div>
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="all_future" id="future" />
                <Label htmlFor="future" className="font-medium cursor-pointer">
                  <div className="text-foreground">All future months</div>
                  <p className="text-xs text-muted-foreground font-normal mt-1">
                    Your budget changes will apply to the month you're editing
                    and all future months.
                  </p>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* More Options */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-4">
              More options
            </h3>
            <div className="space-y-3">
              {/* Recalculate */}
              <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border border-border/50">
                <div>
                  <div className="font-medium text-sm text-foreground">
                    Recalculate default budgets
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Use historical averages to set budgets
                  </div>
                </div>
                <button
                  onClick={handleRecalculate}
                  disabled={isRecalculating}
                  className="text-xs font-medium px-3 py-1.5 bg-card dark:bg-card border border-border rounded hover:bg-muted transition-colors disabled:opacity-60"
                >
                  {isRecalculating ? "Recalculating..." : "Recalculate"}
                </button>
              </div>

              {/* Clear */}
              <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border border-border/50">
                <div>
                  <div className="font-medium text-sm text-foreground">
                    Clear all budget values
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Start over from scratch
                  </div>
                </div>
                <button
                  onClick={handleClear}
                  disabled={isClearing}
                  className="text-xs font-medium px-3 py-1.5 bg-card dark:bg-card border border-border rounded hover:bg-muted transition-colors disabled:opacity-60"
                >
                  {isClearing ? "Clearing..." : "Clear all"}
                </button>
              </div>

              {/* Walkthrough */}
              <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg border border-border/50">
                <div>
                  <div className="font-medium text-sm text-foreground">
                    Budget walkthrough
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Modify your budget step by step with explanations.
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (onStartWalkthrough) {
                      onStartWalkthrough();
                      onClose();
                    }
                  }}
                  className="text-xs font-medium px-3 py-1.5 bg-card dark:bg-card border border-border rounded hover:bg-muted transition-colors"
                >
                  Start setup
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex justify-end gap-3 bg-muted/10">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 text-sm font-bold bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </Card>
    </div>
  );
}
