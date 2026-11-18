import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MerchantFilters } from "./merchants.types";

export function MerchantsFilters({ filters }: { filters: MerchantFilters }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Input
        value={filters.search}
        onChange={(e) => filters.onSearchChange(e.target.value)}
        placeholder="Filter merchants..."
        className="w-[200px]"
      />
      <Input
        type="number"
        min="0"
        value={filters.minSpend}
        onChange={(e) => filters.onMinSpendChange(e.target.value)}
        placeholder="Min spend"
        className="w-[140px]"
      />
      <Input
        type="number"
        min="0"
        value={filters.maxSpend}
        onChange={(e) => filters.onMaxSpendChange(e.target.value)}
        placeholder="Max spend"
        className="w-[140px]"
      />
      <Select
        value={filters.range}
        onValueChange={(value) => {
          if (
            value === "month" ||
            value === "quarter" ||
            value === "year" ||
            value === "custom"
          ) {
            filters.onRangeChange(value);
          }
        }}
      >
        <SelectTrigger className="w-[170px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="month">This month</SelectItem>
          <SelectItem value="quarter">Last 3 months</SelectItem>
          <SelectItem value="year">This year</SelectItem>
          <SelectItem value="custom">Custom range</SelectItem>
        </SelectContent>
      </Select>
      {filters.range === "custom" && (
        <>
          <Input
            type="date"
            value={filters.customFrom}
            onChange={(e) => filters.onCustomFromChange(e.target.value)}
            className="w-[160px]"
          />
          <Input
            type="date"
            value={filters.customTo}
            onChange={(e) => filters.onCustomToChange(e.target.value)}
            className="w-[160px]"
          />
        </>
      )}
      <Select
        value={filters.categoryFilter}
        onValueChange={filters.onCategoryFilterChange}
      >
        <SelectTrigger className="w-[190px]">
          <SelectValue placeholder="All merchant categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {filters.categoryOptions.map((category) => (
            <SelectItem key={category} value={category}>
              {category}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(filters.limit)}
        onValueChange={(v) => filters.onLimitChange(Number(v))}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Top results" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="10">Top 10</SelectItem>
          <SelectItem value="25">Top 25</SelectItem>
          <SelectItem value="50">Top 50</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={filters.sort}
        onValueChange={(value) => {
          if (value === "spend_desc" || value === "name_asc") {
            filters.onSortChange(value);
          }
        }}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="spend_desc">Top spend</SelectItem>
          <SelectItem value="name_asc">Name (A-Z)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
