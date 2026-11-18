/**
 * MoveMoneyModal Component
 *
 * Modal for transferring budget amounts between categories.
 */

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseMoneyInputDecimal } from "@/lib/money";
import type { ApplyScope, MoveMoneyPayload } from "../types";

interface BudgetOption {
  id: string;
  name: string;
}

interface MoveMoneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  options: BudgetOption[];
  initialFromId?: string;
  initialAmount?: string;
  defaultApplyScope: ApplyScope;
  disabledReason?: string;
  fromLocked?: boolean;
  onMove: (payload: MoveMoneyPayload) => void;
  isSaving: boolean;
}

export function MoveMoneyModal({
  isOpen,
  onClose,
  options,
  initialFromId,
  initialAmount,
  defaultApplyScope,
  disabledReason,
  fromLocked,
  onMove,
  isSaving,
}: MoveMoneyModalProps) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [applyScope, setApplyScope] = useState<ApplyScope>(defaultApplyScope);

  useEffect(() => {
    if (!isOpen) return;
    setFromId(initialFromId || "");
    setAmount(initialAmount || "");
    setToId("");
    setApplyScope(defaultApplyScope);
  }, [isOpen, initialFromId, initialAmount, defaultApplyScope]);

  useEffect(() => {
    if (!fromId) return;
    if (fromId === toId) {
      setToId("");
    }
  }, [fromId, toId]);

  if (!isOpen) return null;

  const amountValue = parseMoneyInputDecimal(amount);
  const hasValidAmount =
    amountValue !== null && amountValue.greaterThan(0);
  const canSubmit =
    !disabledReason &&
    fromId &&
    toId &&
    fromId !== toId &&
    hasValidAmount &&
    !isSaving;

  const toOptions = options.filter((option) => option.id !== fromId);

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
      <Card className="w-full max-w-md bg-card shadow-lg overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold text-foreground">Move money</h2>
            <p className="text-xs text-muted-foreground">
              Transfer budget amounts between categories.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1 hover:bg-muted rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Warning */}
          {disabledReason && (
            <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {disabledReason}
            </div>
          )}

          {/* From Select */}
          <div className="space-y-2">
            <Label htmlFor="move-from">From</Label>
            <Select
              value={fromId}
              onValueChange={setFromId}
              disabled={Boolean(disabledReason) || Boolean(fromLocked)}
            >
              <SelectTrigger id="move-from">
                <SelectValue placeholder="Select source budget" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* To Select */}
          <div className="space-y-2">
            <Label htmlFor="move-to">To</Label>
            <Select
              value={toId}
              onValueChange={setToId}
              disabled={Boolean(disabledReason) || !fromId}
            >
              <SelectTrigger id="move-to">
                <SelectValue placeholder="Select destination budget" />
              </SelectTrigger>
              <SelectContent>
                {toOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="move-amount">Amount</Label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 text-xs">
                $
              </span>
              <input
                id="move-amount"
                type="text"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={Boolean(disabledReason)}
                className="w-full text-right py-2 px-3 rounded-md border border-border bg-background dark:bg-card focus:border-primary focus:ring-1 focus:ring-primary outline-none text-sm font-medium disabled:opacity-60"
              />
            </div>
          </div>

          {/* Apply Scope */}
          <div className="space-y-3">
            <Label>Apply change to</Label>
            <RadioGroup
              value={applyScope}
              onValueChange={(value) => setApplyScope(value as ApplyScope)}
              disabled={Boolean(disabledReason)}
            >
              <div className="flex items-start space-x-3">
                <RadioGroupItem value="this_month" id="move-month" />
                <Label
                  htmlFor="move-month"
                  className="font-medium cursor-pointer"
                >
                  <div className="text-foreground text-sm">This month only</div>
                  <p className="text-xs text-muted-foreground font-normal mt-1">
                    Apply to the selected month only.
                  </p>
                </Label>
              </div>
              <div className="flex items-start space-x-3 mt-3">
                <RadioGroupItem value="all_future" id="move-future" />
                <Label
                  htmlFor="move-future"
                  className="font-medium cursor-pointer"
                >
                  <div className="text-foreground text-sm">
                    All future months
                  </div>
                  <p className="text-xs text-muted-foreground font-normal mt-1">
                    Apply to this month and all future months.
                  </p>
                </Label>
              </div>
            </RadioGroup>
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
            onClick={() => {
              if (!canSubmit) return;
              onMove({
                fromBudgetId: fromId,
                toBudgetId: toId,
                amount: amountValue.toString(),
                applyScope,
              });
            }}
            disabled={!canSubmit}
            className="px-6 py-2 text-sm font-bold bg-orange-500 text-white rounded-md hover:bg-orange-600 transition-colors disabled:opacity-60"
          >
            {isSaving ? "Moving..." : "Move"}
          </button>
        </div>
      </Card>
    </div>
  );
}
