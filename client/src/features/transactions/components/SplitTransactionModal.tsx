/**
 * Split Transaction Modal Component
 *
 * Modal for splitting a transaction across multiple categories.
 * Allows allocating portions of the total amount to different categories.
 */

import { useState, useMemo, useCallback } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Plus, Trash2, AlertCircle } from "lucide-react";
import {
  formatCurrency,
  formatAmount,
  toMoneyDto,
  parseMoneyString,
  sumMoneyValues,
  multiplyMoneyDto,
} from "@/lib/money";
import { useCategories } from "@/hooks/useCategories";
import type { TransactionWithDetails } from "../types";
import type { MoneyDto } from "@shared/money";

interface SplitItem {
  id: string;
  amount: string;
  categoryId: string;
  notes: string;
}

interface SplitTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionWithDetails | null;
  onSubmit: (
    splits: Array<{ amount: MoneyDto; categoryId: string; notes?: string }>,
  ) => void;
  isLoading?: boolean;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function SplitTransactionModal({
  open,
  onOpenChange,
  transaction,
  onSubmit,
  isLoading = false,
}: Readonly<SplitTransactionModalProps>) {
  const { data: categoriesData } = useCategories();
  const categories = categoriesData?.categories ?? [];

  // Group categories by group type
  const groupedCategories = useMemo(() => {
    const groups: Record<string, typeof categories> = {};
    for (const cat of categories) {
      const group = cat.groupType || "Other";
      groups[group] = groups[group] ?? [];
      groups[group].push(cat);
    }
    return groups;
  }, [categories]);

  // Initialize with two empty splits
  const [splits, setSplits] = useState<SplitItem[]>([
    { id: generateId(), amount: "", categoryId: "", notes: "" },
    { id: generateId(), amount: "", categoryId: "", notes: "" },
  ]);

  // Reset when modal opens
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen && transaction) {
        const halfAmount = multiplyMoneyDto(transaction.amount, 0.5).amount;
        setSplits([
          {
            id: generateId(),
            amount: halfAmount,
            categoryId: transaction.categoryId ?? "",
            notes: "",
          },
          {
            id: generateId(),
            amount: halfAmount,
            categoryId: "",
            notes: "",
          },
        ]);
      }
      onOpenChange(isOpen);
    },
    [onOpenChange, transaction],
  );

  // Calculate totals with Decimal precision (avoid float drift on split sums).
  const totalAmount = transaction
    ? parseMoneyString(transaction.amount.amount).abs()
    : parseMoneyString(0);
  const allocatedAmount = useMemo(
    () => sumMoneyValues(splits.map((split) => split.amount)),
    [splits],
  );

  const remainingAmount = totalAmount.minus(allocatedAmount);
  const isBalanced = remainingAmount.abs().lessThan(0.01);

  // Split handlers
  const addSplit = () => {
    setSplits([
      ...splits,
      { id: generateId(), amount: "", categoryId: "", notes: "" },
    ]);
  };

  const removeSplit = (id: string) => {
    if (splits.length > 2) {
      setSplits(splits.filter((s) => s.id !== id));
    }
  };

  const updateSplit = (id: string, field: keyof SplitItem, value: string) => {
    setSplits(splits.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const handleSubmit = () => {
    if (!transaction || !isBalanced) return;

    const currency = transaction.amount.currency;
    const splitData = splits
      .filter((s) => parseMoneyString(s.amount).greaterThan(0) && s.categoryId)
      .map((s) => ({
        amount: toMoneyDto(s.amount, currency),
        categoryId: s.categoryId,
        notes: s.notes || undefined,
      }));

    onSubmit(splitData);
  };

  if (!transaction) return null;

  const displayName =
    transaction.merchantName || transaction.name || "Transaction";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Split Transaction</DialogTitle>
          <DialogDescription>
            Divide{" "}
            <span className="font-medium text-foreground">{displayName}</span> (
            {formatCurrency(transaction.amount)}) across multiple categories.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
          {splits.map((split, index) => (
            <div
              key={split.id}
              className="p-3 border rounded-lg space-y-3 bg-muted/20"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Split {index + 1}
                </span>
                {splits.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => removeSplit(split.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={split.amount}
                    onChange={(e) =>
                      updateSplit(split.id, "amount", e.target.value)
                    }
                    placeholder="0.00"
                    className="h-9"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Select
                    value={split.categoryId}
                    onValueChange={(val) =>
                      updateSplit(split.id, "categoryId", val)
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(groupedCategories).map(
                        ([group, cats]) => (
                          <SelectGroup key={group}>
                            <SelectLabel>{group}</SelectLabel>
                            {cats.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Notes (optional)</Label>
                <Input
                  value={split.notes}
                  onChange={(e) =>
                    updateSplit(split.id, "notes", e.target.value)
                  }
                  placeholder="Add a note..."
                  className="h-9"
                />
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={addSplit}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Split
          </Button>
        </div>

        {/* Balance indicator */}
        <div
          className={`flex items-center justify-between p-3 rounded-lg border ${
            isBalanced
              ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
              : "bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {!isBalanced && <AlertCircle className="h-4 w-4 text-amber-500" />}
            <span className="text-sm font-medium">
              {isBalanced ? "Balanced!" : "Remaining:"}
            </span>
          </div>
          <span
            className={`font-semibold ${isBalanced ? "text-green-600" : "text-amber-600"}`}
          >
            {isBalanced
              ? "✓"
              : `$${formatAmount(remainingAmount.abs().toNumber())}`}
          </span>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !isBalanced}>
            {isLoading ? "Saving..." : "Save Splits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
