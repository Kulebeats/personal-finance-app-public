import type { MoneyValue } from "@shared/money";

export interface MerchantItem {
  id: string;
  label: string;
  value: MoneyValue;
  entityId?: string;
  color?: string;
}

export interface MerchantFilters {
  search: string;
  onSearchChange: (value: string) => void;
  minSpend: string;
  onMinSpendChange: (value: string) => void;
  maxSpend: string;
  onMaxSpendChange: (value: string) => void;
  range: "month" | "quarter" | "year" | "custom";
  onRangeChange: (value: "month" | "quarter" | "year" | "custom") => void;
  customFrom: string;
  onCustomFromChange: (value: string) => void;
  customTo: string;
  onCustomToChange: (value: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  categoryOptions: string[];
  limit: number;
  onLimitChange: (value: number) => void;
  sort: "spend_desc" | "name_asc";
  onSortChange: (value: "spend_desc" | "name_asc") => void;
}

export type MerchantTrendSeries = Array<{
  id: string;
  data: Array<{ x: string; y: number }>;
}>;
