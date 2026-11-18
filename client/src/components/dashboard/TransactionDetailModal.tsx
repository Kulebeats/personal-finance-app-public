import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { CalendarIcon, type LucideIcon } from "lucide-react";
import { useFormatters } from "@/contexts/SettingsContext";
import { useEffect, useMemo, useState } from "react";
import type { Category } from "@/hooks/useCategories";

/**
 * Display representation of a transaction for the modal
 */
interface TransactionDisplay {
  id: string;
  name: string;
  date: string;
  amount: number;
  type?: "income" | "expense" | "transfer" | "balance_adjustment";
  categoryId?: string;
  categoryName?: string;
  icon: LucideIcon;
}

interface TransactionDetailModalProps {
  transaction: TransactionDisplay | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories?: Category[];
  categoriesLoading?: boolean;
}

export function TransactionDetailModal({
  transaction,
  open,
  onOpenChange,
  categories = [],
  categoriesLoading = false,
}: TransactionDetailModalProps) {
  const { formatCurrency } = useFormatters();
  const [selectedCategoryId, setSelectedCategoryId] = useState(
    transaction?.categoryId ?? ""
  );

  useEffect(() => {
    if (!open) return;
    setSelectedCategoryId(transaction?.categoryId ?? "");
  }, [open, transaction?.categoryId]);

  const groupedCategories = useMemo(() => {
    if (categories.length === 0) return [];
    const grouped = categories.reduce((acc, category) => {
      const groupName = category.groupName || "Other";
      if (!acc[groupName]) acc[groupName] = [];
      acc[groupName].push(category);
      return acc;
    }, {} as Record<string, Category[]>);

    return Object.entries(grouped);
  }, [categories]);

  const currentCategory = categories.find(
    (category) => category.id === selectedCategoryId
  );

  if (!transaction) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Transaction Details</DialogTitle>
          <DialogDescription>
            Review and edit transaction information.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="flex items-center justify-center mb-4">
             <div className="text-3xl font-bold">
                {transaction.type === "income" ? "+" : ""}{formatCurrency(transaction.amount)}
             </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="merchant" className="text-right">
              Merchant
            </Label>
            <Input id="merchant" defaultValue={transaction.name} className="col-span-3" />
          </div>
          
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="date" className="text-right">
              Date
            </Label>
            <div className="col-span-3 relative">
                <CalendarIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input id="date" defaultValue={transaction.date} className="pl-9" />
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="category" className="text-right">
              Category
            </Label>
            <Select
              value={currentCategory ? selectedCategoryId : ""}
              onValueChange={setSelectedCategoryId}
              disabled={categoriesLoading || groupedCategories.length === 0}
            >
              <SelectTrigger className="col-span-3">
                <SelectValue
                  placeholder={transaction.categoryName || "Select category"}
                />
              </SelectTrigger>
              <SelectContent>
                {categoriesLoading ? (
                  <SelectItem value="loading" disabled>
                    Loading categories...
                  </SelectItem>
                ) : groupedCategories.length === 0 ? (
                  <SelectItem value="empty" disabled>
                    No categories available
                  </SelectItem>
                ) : (
                  groupedCategories.map(([groupName, groupCategories]) => (
                    <SelectGroup key={groupName}>
                      <SelectLabel>{groupName}</SelectLabel>
                      {groupCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.icon ? (
                            <span className="mr-2">{category.icon}</span>
                          ) : null}
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="notes" className="text-right">
              Notes
            </Label>
            <Input id="notes" placeholder="Add a note..." className="col-span-3" />
          </div>
        </div>
        <div className="flex justify-between">
            <Button variant="outline" className="text-destructive hover:text-destructive">Delete</Button>
            <Button type="submit" onClick={() => onOpenChange(false)}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
