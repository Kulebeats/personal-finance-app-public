/**
 * Split Transaction Modal Component
 *
 * Modal for splitting a transaction across multiple categories.
 * Allows allocating portions of the total amount to different categories.
 */

import { useState, useMemo } from "react";
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
  toMoneyDto,
  parseMoneyString,
  sumMoneyValues,
} from "@/lib/money";
import { useCategories } from "@/hooks/useCategories";
import type { TransactionWithDetails } from "../types";
import type { UpdateTransactionInput } from "@/lib/api";

interface SplitItem {
  id: string;
  amount: string;
  categoryId: string;
  notes: string;
  merchantId?: string | null;
  displayOrder?: number;
}

interface SplitTransactionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: TransactionWithDetails | null;
  onSubmit: (
    splits: NonNullable<UpdateTransactionInput["splits"]>, expectedUpdatedAt: string,
  ) => void;
  isLoading?: boolean;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function SplitTransactionModal(props: Readonly<SplitTransactionModalProps>) {
  if (!props.open || !props.transaction) return null;
  return <SplitEditor key={props.transaction.id} {...props} transaction={props.transaction} />;
}

function SplitEditor({ transaction: current, onOpenChange, onSubmit, isLoading }: Readonly<
  SplitTransactionModalProps & { transaction: TransactionWithDetails }
>) {
  // Keep the opening version with the user's draft until this editor closes.
  const [transaction] = useState(current);
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

  const totalAmount = parseMoneyString(transaction.amount.amount);
  const currency = transaction.currency === undefined ? transaction.amount.currency : transaction.currency;
  const knownCurrency = !!currency && transaction.amount.currency === currency &&
    (transaction.splits ?? []).every(split => split.amount.currency === currency);
  const [splits, setSplits] = useState<SplitItem[]>(() => {
    if (transaction.splits?.length) return transaction.splits.map(split => ({
      id: split.id, amount: split.amount.amount, categoryId: split.categoryId ?? "",
      merchantId: split.merchantId, notes: split.notes ?? "", displayOrder: split.displayOrder,
    }));
    const half = totalAmount.dividedBy(2).toFixed(2);
    return [
      { id: generateId(), amount: half, categoryId: transaction.categoryId ?? "", notes: "" },
      { id: generateId(), amount: totalAmount.minus(half).toFixed(2), categoryId: "", notes: "" },
    ];
  });
  const allocatedAmount = useMemo(
    () => sumMoneyValues(splits.map((split) => split.amount)),
    [splits],
  );

  const remainingAmount = totalAmount.minus(allocatedAmount);
  const isBalanced = remainingAmount.isZero() && splits.every(split =>
    /^\d+(?:\.\d{1,2})?$/.test(split.amount) && parseMoneyString(split.amount).gt(0));
  const canSave = isBalanced && knownCurrency && Number.isFinite(Date.parse(transaction.updatedAt)) &&
    (transaction.type === "expense" || transaction.type === "income") && splits.length <= 50;

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

  const updateSplit = (id: string, field: "amount" | "categoryId" | "notes", value: string) => {
    setSplits(splits.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const handleSubmit = () => {
    if (!canSave || !currency) return;
    const retainOrder = splits.every((s, index) => s.displayOrder !== undefined &&
      (index === 0 || s.displayOrder > (splits[index - 1].displayOrder ?? -1)));
    onSubmit(splits.map((s, index) => ({
      amount: toMoneyDto(s.amount, currency), categoryId: s.categoryId || null, notes: s.notes || undefined,
      ...(s.merchantId ? { merchantId: s.merchantId } : {}),
      displayOrder: retainOrder ? s.displayOrder : index,
    })), transaction.updatedAt);
  };

  const displayName =
    transaction.merchantName || transaction.name || "Transaction";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Split Transaction</DialogTitle>
          <DialogDescription>
            Divide{" "}
            <span className="font-medium text-foreground">{displayName}</span> (
            {knownCurrency ? formatCurrency(transaction.amount) : `${transaction.amount.amount}, currency unknown`}) across multiple categories.
            {!knownCurrency && " Reconcile the transaction currency before saving allocations."}
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
            disabled={splits.length >= 50}
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
              : remainingAmount.abs().toFixed(2)}
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
          <Button onClick={handleSubmit} disabled={isLoading || !canSave}>
            {isLoading ? "Saving..." : "Save Splits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
