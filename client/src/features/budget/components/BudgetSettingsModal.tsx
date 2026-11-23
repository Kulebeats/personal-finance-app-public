/**
 * BudgetSettingsModal Component
 *
 * Modal for configuring budget system settings. It is a real dialog
 * (BudgetDialogShell: role, label, Escape, focus trap and return), and the
 * budget system is a radio group, so it can be chosen from the keyboard.
 */

import { useState, useEffect, useId } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import type { BudgetSettings, ApplyScope } from "../types";
import { BudgetDialogShell } from "./BudgetDialogShell";
import { BudgetRecalculationPreview, type BudgetPreviewNames } from "./BudgetRecalculationPreview";
import type { BudgetPreviewController } from "../hooks/useBudgetRecalculationPreview";

type BudgetSystem = "flex" | "category";

interface BudgetSettingsModalProps extends BudgetPreviewNames {
  preview: BudgetPreviewController;
  isOpen: boolean;
  onClose: () => void;
  budgetSystem: BudgetSystem;
  defaultApplyScope: ApplyScope;
  onSaveSettings: (settings: BudgetSettings) => void;
  onClear: () => void;
  isSaving: boolean;
  isClearing: boolean;
  onStartWalkthrough?: () => void;
}

interface SystemOptionProps {
  value: BudgetSystem;
  title: string;
  detail: string;
  badge?: string;
  isSelected: boolean;
  idPrefix: string;
}

/** One budget system: a radio named by its title and described by its detail; the whole card selects it. */
function SystemOption({ value, title, detail, badge, isSelected, idPrefix }: SystemOptionProps) {
  const id = `${idPrefix}-${value}`;
  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg border transition-all",
        isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30",
      )}
    >
      <RadioGroupItem value={value} id={id} aria-labelledby={`${id}-title`} aria-describedby={`${id}-detail`} className="mt-1" />
      <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
        <span className="flex items-center justify-between">
          <span id={`${id}-title`} className="font-bold text-foreground">{title}</span>
          {badge && (
            <span className="text-[10px] font-bold bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 px-1.5 py-0.5 rounded uppercase">
              {badge}
            </span>
          )}
        </span>
        <span id={`${id}-detail`} className="block text-sm text-muted-foreground mt-1">{detail}</span>
      </Label>
    </div>
  );
}

export function BudgetSettingsModal({
  preview,
  isOpen,
  onClose,
  budgetSystem,
  defaultApplyScope,
  onSaveSettings,
  categories,
  categoryGroups,
  onClear,
  isSaving,
  isClearing,
  onStartWalkthrough,
}: BudgetSettingsModalProps) {
  const [localBudgetSystem, setLocalBudgetSystem] = useState<BudgetSystem>(budgetSystem);
  const [localApplyScope, setLocalApplyScope] = useState<ApplyScope>(defaultApplyScope);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const idPrefix = useId();
  const systemHeadingId = `${idPrefix}-system`;
  const scopeHeadingId = `${idPrefix}-scope`;

  useEffect(() => {
    setLocalBudgetSystem(budgetSystem);
  }, [budgetSystem]);

  useEffect(() => {
    setLocalApplyScope(defaultApplyScope);
  }, [defaultApplyScope]);

  const handleSave = () => {
    onSaveSettings({
      budgetSystem: localBudgetSystem,
      defaultApplyScope: localApplyScope,
    });
  };

  return (
    <BudgetDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Budget Settings"
      description="Choose your budget system and which months a budget change applies to by default."
      isLocked={isSaving}
      className="max-w-lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={isSaving}
            className="px-6 py-2 text-sm font-bold bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors disabled:opacity-60">
            {isSaving ? "Saving..." : "Save"}
          </button>
        </>
      }
    >
      <div className="p-6 space-y-8">
        {/* System Section */}
        <div>
          <h3 id={systemHeadingId} className="text-sm font-semibold text-muted-foreground mb-4">
            System
          </h3>
          <RadioGroup
            value={localBudgetSystem}
            onValueChange={(value) => setLocalBudgetSystem(value === "category" ? "category" : "flex")}
            aria-labelledby={systemHeadingId}
            className="gap-4"
          >
            <SystemOption value="flex" title="Flex Budget" badge="Recommended" idPrefix={idPrefix}
              detail="Simplify your budget by focusing on your flexible expense number."
              isSelected={localBudgetSystem === "flex"} />
            <SystemOption value="category" title="Category Budget" idPrefix={idPrefix}
              detail="Budget every category individually, the traditional way."
              isSelected={localBudgetSystem === "category"} />
          </RadioGroup>
        </div>

        {/* Apply Changes To */}
        <div>
          <h3 id={scopeHeadingId} className="text-sm font-semibold text-muted-foreground mb-4">
            By default, apply budget changes to
          </h3>
          <RadioGroup
            value={localApplyScope}
            onValueChange={(value) => setLocalApplyScope(value as ApplyScope)}
            aria-labelledby={scopeHeadingId}
          >
            <div className="flex items-start space-x-3 mb-4">
              <RadioGroupItem value="this_month" id={`${idPrefix}-month`} />
              <Label htmlFor={`${idPrefix}-month`} className="font-medium cursor-pointer">
                <div className="text-foreground">This month only</div>
                <p className="text-xs text-muted-foreground font-normal mt-1">
                  Your budget changes will only apply to the month you're
                  editing.
                </p>
              </Label>
            </div>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="all_future" id={`${idPrefix}-future`} />
              <Label htmlFor={`${idPrefix}-future`} className="font-medium cursor-pointer">
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
            <BudgetRecalculationPreview preview={preview} categories={categories} categoryGroups={categoryGroups} />

            {/* Clear */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-muted/20 rounded-lg border border-border/50">
              <div className="min-w-0">
                <div className="font-medium text-sm text-foreground">
                  Clear all budget values
                </div>
                <div className="text-xs text-muted-foreground">
                  Start over from scratch
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsClearConfirmOpen(true)}
                disabled={isClearing}
                className="text-xs font-medium px-3 py-1.5 bg-card dark:bg-card border border-border rounded hover:bg-muted transition-colors disabled:opacity-60"
              >
                {isClearing ? "Clearing..." : "Clear all"}
              </button>
              <ConfirmActionDialog
                open={isClearConfirmOpen}
                onOpenChange={setIsClearConfirmOpen}
                title="Clear all budget values?"
                description="Every category budget amount in your household is removed. Your flex budget is kept. This cannot be undone."
                confirmLabel="Clear all values"
                onConfirm={onClear}
              />
            </div>

            {/* Walkthrough */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-muted/20 rounded-lg border border-border/50">
              <div className="min-w-0">
                <div className="font-medium text-sm text-foreground">
                  Budget walkthrough
                </div>
                <div className="text-xs text-muted-foreground">
                  Modify your budget step by step with explanations.
                </div>
              </div>
              <button
                type="button"
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
    </BudgetDialogShell>
  );
}
