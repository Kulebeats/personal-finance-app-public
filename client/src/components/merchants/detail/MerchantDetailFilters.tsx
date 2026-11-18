/**
 * Filters for Merchant Detail View
 */

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Category {
  id: string;
  name: string;
}

interface MerchantDetailFiltersProps {
  startDate: string;
  endDate: string;
  groupBy: "month" | "day";
  categoryId: string;
  minAmount: string;
  maxAmount: string;
  categories: Category[];
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onGroupByChange: (groupBy: "month" | "day") => void;
  onCategoryChange: (categoryId: string) => void;
  onMinAmountChange: (amount: string) => void;
  onMaxAmountChange: (amount: string) => void;
}

export function MerchantDetailFilters({
  startDate,
  endDate,
  groupBy,
  categoryId,
  minAmount,
  maxAmount,
  categories,
  onStartDateChange,
  onEndDateChange,
  onGroupByChange,
  onCategoryChange,
  onMinAmountChange,
  onMaxAmountChange,
}: MerchantDetailFiltersProps) {
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div>
        <p className="text-xs text-muted-foreground">From</p>
        <Input
          type="date"
          value={startDate}
          onChange={(event) => onStartDateChange(event.target.value)}
        />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">To</p>
        <Input
          type="date"
          value={endDate}
          onChange={(event) => onEndDateChange(event.target.value)}
        />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Group by</p>
        <select
          className="h-9 rounded border border-input bg-background px-3 text-sm"
          value={groupBy}
          onChange={(event) =>
            onGroupByChange(event.target.value as "day" | "month")
          }
        >
          <option value="month">Month</option>
          <option value="day">Day</option>
        </select>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Category</p>
        <Select value={categoryId} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Min amount</p>
        <Input
          type="number"
          min="0"
          value={minAmount}
          onChange={(event) => onMinAmountChange(event.target.value)}
          placeholder="0"
          className="w-[140px]"
        />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Max amount</p>
        <Input
          type="number"
          min="0"
          value={maxAmount}
          onChange={(event) => onMaxAmountChange(event.target.value)}
          placeholder="Any"
          className="w-[140px]"
        />
      </div>
    </div>
  );
}
