/**
 * BudgetEditModal Component
 *
 * Modal for editing a category budget amount. A real dialog (BudgetDialogShell);
 * it opens with focus in the amount field.
 */

import { useState, useEffect, useId, useRef } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { BudgetEditData, ApplyScope } from "../types";
import { BudgetDialogShell } from "./BudgetDialogShell";
import type { DialogOpener } from "../hooks/useDialogOpener";

interface BudgetEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: BudgetEditData | null;
  defaultApplyScope: ApplyScope;
  onSave: (payload: BudgetEditData & { applyScope: ApplyScope }) => void;
  isSaving: boolean;
  /**
   * The control that opened it, recorded by the parent (useDialogOpener):
   * this modal renders nothing until it has data, so it mounts already open.
   */
  opener?: DialogOpener;
}

export function BudgetEditModal({
  isOpen,
  onClose,
  data,
  defaultApplyScope,
  onSave,
  isSaving,
  opener,
}: BudgetEditModalProps) {
  const [amount, setAmount] = useState("");
  const [applyScope, setApplyScope] = useState<ApplyScope>(defaultApplyScope);
  const amountRef = useRef<HTMLInputElement>(null);
  const idPrefix = useId();

  useEffect(() => {
    if (!data) return;
    setAmount(String(data.amount ?? ""));
    setApplyScope(defaultApplyScope);
  }, [data, defaultApplyScope]);

  if (!data) return null;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSave({
      ...data,
      amount,
      applyScope,
    });
  };

  const periodLabel = new Date(data.year, data.month - 1).toLocaleString(
    "default",
    {
      month: "long",
      year: "numeric",
    },
  );

  return (
    <BudgetDialogShell
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Budget"
      description={`Set the ${data.categoryName} budget for ${periodLabel} and choose which months it applies to.`}
      isLocked={isSaving}
      className="max-w-md"
      onOpenAutoFocus={(event) => { event.preventDefault(); amountRef.current?.focus(); }}
      onSubmit={handleSubmit}
      opener={opener}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={isSaving}
            className="px-6 py-2 text-sm font-bold bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors disabled:opacity-60">
            {isSaving ? "Saving..." : "Save"}
          </button>
        </>
      }
    >
          <div className="p-6 space-y-6">
            {/* Category Info */}
            <div>
              <div className="text-sm text-muted-foreground">Category</div>
              <div className="text-lg font-semibold text-foreground">
                {data.categoryName}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {periodLabel}
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <Label htmlFor={`${idPrefix}-amount`} className="text-sm font-medium">
                Budget Amount
              </Label>
              <input
                ref={amountRef}
                id={`${idPrefix}-amount`}
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-2 w-full px-3 py-2 rounded-md border border-border bg-background dark:bg-card focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm"
                placeholder="0.00"
              />
            </div>

            {/* Apply Scope */}
            <div>
              <p id={`${idPrefix}-scope`} className="text-sm font-medium mb-3">
                Apply changes to
              </p>
              <RadioGroup
                aria-labelledby={`${idPrefix}-scope`}
                value={applyScope}
                onValueChange={(v) => setApplyScope(v as ApplyScope)}
              >
                <div className="flex items-center space-x-2 mb-2">
                  <RadioGroupItem value="this_month" id="edit-this-month" />
                  <Label
                    htmlFor="edit-this-month"
                    className="font-normal cursor-pointer"
                  >
                    This month only
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all_future" id="edit-all-future" />
                  <Label
                    htmlFor="edit-all-future"
                    className="font-normal cursor-pointer"
                  >
                    This and all future months
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
    </BudgetDialogShell>
  );
}
