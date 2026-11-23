/**
 * ForecastEditModal Component
 *
 * Modal for editing a forecast cell in the budget forecast table.
 */

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ForecastEditData, ApplyScope } from "../types";

interface ForecastEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ForecastEditData | null;
  defaultApplyScope: ApplyScope;
  onSave: (payload: {
    budgetId: string;
    year: number;
    month: number;
    amount: string;
    currency: string;
    applyScope: ApplyScope;
  }) => void;
  isSaving: boolean;
}

export function ForecastEditModal({
  isOpen,
  onClose,
  data,
  defaultApplyScope,
  onSave,
  isSaving,
}: ForecastEditModalProps) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [applyScope, setApplyScope] = useState<ApplyScope>(defaultApplyScope);

  useEffect(() => {
    if (!data) return;
    setAmount(String(data.amount ?? ""));
    setCurrency(data.currency ?? "");
    setApplyScope(defaultApplyScope);
  }, [data, defaultApplyScope]);

  if (!isOpen || !data) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[A-Z]{3}$/.test(currency) || amount.trim() === "") return;
    onSave({
      budgetId: data.budgetId,
      year: data.year,
      month: data.month,
      amount,
      currency,
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
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
      <Card className="w-full max-w-md bg-card shadow-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">Edit Forecast</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 hover:bg-muted rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-6">
            {/* Budget Info */}
            <div>
              <div className="text-sm text-muted-foreground">Budget</div>
              <div className="text-lg font-semibold text-foreground">
                {data.budgetName}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {periodLabel}
              </div>
            </div>

            {/* Amount Input */}
            <div>
              <Label htmlFor="forecast-amount" className="text-sm font-medium">
                Budget Amount
              </Label>
              <input
                id="forecast-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-2 w-full px-3 py-2 rounded-md border border-border bg-background dark:bg-card focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm"
                placeholder="0.00"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="forecast-currency" className="text-sm font-medium">Currency</Label>
              <input id="forecast-currency" type="text" value={currency} required maxLength={3} pattern="[A-Z]{3}"
                readOnly={Boolean(data.currency)} onChange={event => setCurrency(event.target.value.toUpperCase())}
                className="mt-2 w-full px-3 py-2 rounded-md border border-border bg-background text-sm"
                placeholder="e.g. USD" />
              {!data.currency && <p className="mt-1 text-sm text-muted-foreground">Choose the currency for this monthly limit.</p>}
            </div>

            {/* Apply Scope */}
            <div>
              <Label className="text-sm font-medium mb-3 block">
                Apply changes to
              </Label>
              <RadioGroup
                value={applyScope}
                onValueChange={(v) => setApplyScope(v as ApplyScope)}
              >
                <div className="flex items-center space-x-2 mb-2">
                  <RadioGroupItem value="this_month" id="forecast-this-month" />
                  <Label
                    htmlFor="forecast-this-month"
                    className="font-normal cursor-pointer"
                  >
                    This month only
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all_future" id="forecast-all-future" />
                  <Label
                    htmlFor="forecast-all-future"
                    className="font-normal cursor-pointer"
                  >
                    This and all future months
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border flex justify-end gap-3 bg-muted/10">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !/^[A-Z]{3}$/.test(currency) || amount.trim() === ""}
              className="px-6 py-2 text-sm font-bold bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors disabled:opacity-60"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
