/**
 * useMerchantFilters Hook
 *
 * Manages all merchant-related filter state and derived data
 */

import { useState, useMemo, useEffect } from "react";
import {
  useReportsSpendingBreakdown,
  useReportsSpendingTrend,
  useCurrentMonthRange,
  useLastNMonthsRange,
} from "@/hooks/use-reports";
import { useMerchants } from "@/hooks/use-settings";
import { DEFAULT_MERCHANT_LIMIT } from "../constants";
import {
  sumMoneyDto,
  toMoneyNumber,
  zeroMoneyDto,
  parseMoneyString,
  moneyValueToDecimal,
  subtractMoneyValues,
  type MoneyDto,
  type MoneyValue,
} from "@/lib/money";

// Synthetic id of the server's "No merchant" breakdown bucket
// (SpendingReportRepository). It is not a merchant uuid, so it must never be
// sent as a trend filter.
export const NO_MERCHANT_ID = "no-merchant";

// A zero in the report currency, or a bare zero while that currency is
// unknown: never a guessed one (a kwacha household must not see US$0.00).
const zeroIn = (currency: string | null): MoneyValue =>
  currency ? zeroMoneyDto(currency) : "0.00";
const sumIn = (values: MoneyDto[], currency: string | null): MoneyValue =>
  values.length > 0 ? sumMoneyDto(values) : zeroIn(currency);

interface UseMerchantFiltersOptions {
  yearRange: { from: string; to: string };
  enabled?: boolean;
}

export function useMerchantFilters({
  yearRange,
  enabled = true,
}: UseMerchantFiltersOptions) {
  // Filter state
  const [search, setSearch] = useState("");
  const [minSpend, setMinSpend] = useState("");
  const [maxSpend, setMaxSpend] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(
    null
  );
  const [range, setRange] = useState<"month" | "quarter" | "year" | "custom">(
    "month"
  );
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sort, setSort] = useState<"spend_desc" | "name_asc">("spend_desc");
  const [limit, setLimit] = useState(DEFAULT_MERCHANT_LIMIT);

  // Date ranges
  const monthRange = useCurrentMonthRange();
  const quarterRange = useLastNMonthsRange(3);
  const { data: merchants } = useMerchants();

  const dateRange = useMemo(() => {
    if (range === "custom") {
      return {
        from: customFrom || monthRange.from,
        to: customTo || monthRange.to,
      };
    }
    if (range === "quarter") return quarterRange;
    if (range === "year") return yearRange;
    return monthRange;
  }, [range, customFrom, customTo, monthRange, quarterRange, yearRange]);

  // API calls
  const { data: merchantBreakdown, isLoading: isLoadingMerchants } =
    useReportsSpendingBreakdown(
      { from: dateRange.from, to: dateRange.to, groupBy: "merchant", limit },
      { enabled }
    );

  const { data: categoryBreakdown, isLoading: isLoadingCategories } =
    useReportsSpendingBreakdown(
      {
        from: dateRange.from,
        to: dateRange.to,
        groupBy: "merchantCategory",
        limit: 12,
      },
      { enabled }
    );

  const trendMerchantId =
    selectedMerchantId === NO_MERCHANT_ID ? null : selectedMerchantId;
  const { data: trendData, isLoading: isLoadingTrend } =
    useReportsSpendingTrend(
      {
        from: dateRange.from,
        to: dateRange.to,
        interval: "month",
        merchantId: trendMerchantId ?? undefined,
      },
      { enabled: enabled && Boolean(trendMerchantId) }
    );

  // Derived data
  const categoryMap = useMemo(() => {
    return new Map(
      (merchants || []).map((m) => [m.id, m.category || "Uncategorized"])
    );
  }, [merchants]);

  const categoryOptions = useMemo(() => {
    const options = new Set<string>();
    (merchants || []).forEach((m) =>
      options.add(m.category || "Uncategorized")
    );
    return Array.from(options).sort();
  }, [merchants]);

  // Min/max spend thresholds parsed with Decimal precision (no float parsing).
  const minValue = useMemo(() => parseMoneyString(minSpend), [minSpend]);

  const maxValue = useMemo(
    () => (maxSpend.trim() ? parseMoneyString(maxSpend) : undefined),
    [maxSpend]
  );

  const hasMinFilter = useMemo(() => minValue.greaterThan(0), [minValue]);

  const filteredItems = useMemo(() => {
    if (!merchantBreakdown?.items) return [];
    const query = search.trim().toLowerCase();
    const filtered = merchantBreakdown.items.filter((item) => {
      const itemValue = moneyValueToDecimal(item.value);
      const matchesQuery = query
        ? item.label.toLowerCase().includes(query)
        : true;
      const meetsMin = itemValue.greaterThanOrEqualTo(minValue);
      const meetsMax =
        maxValue !== undefined ? itemValue.lessThanOrEqualTo(maxValue) : true;
      const merchantCategory =
        categoryMap.get(item.entityId || item.id) || "Uncategorized";
      const matchesCategory =
        categoryFilter === "all" || merchantCategory === categoryFilter;
      return matchesQuery && meetsMin && meetsMax && matchesCategory;
    });
    return [...filtered].sort((a, b) =>
      sort === "name_asc"
        ? a.label.localeCompare(b.label)
        : subtractMoneyValues(b.value, a.value).toNumber()
    );
  }, [
    merchantBreakdown,
    search,
    minValue,
    maxValue,
    sort,
    categoryFilter,
    categoryMap,
  ]);

  const selectedMerchant = useMemo(() => {
    if (!selectedMerchantId) return null;
    return (
      filteredItems.find(
        (item) => (item.entityId || item.id) === selectedMerchantId
      ) || null
    );
  }, [filteredItems, selectedMerchantId]);

  const total = useMemo(() => {
    const baseCurrency = merchantBreakdown?.range?.baseCurrency || null;
    if (!merchantBreakdown) return zeroIn(baseCurrency);
    const hasFilters =
      search.trim().length > 0 ||
      maxValue !== undefined ||
      hasMinFilter ||
      categoryFilter !== "all";
    if (!hasFilters) {
      return merchantBreakdown.total || zeroIn(baseCurrency);
    }
    return sumIn(filteredItems.map((item) => item.value), baseCurrency);
  }, [
    merchantBreakdown,
    filteredItems,
    search,
    maxValue,
    hasMinFilter,
    categoryFilter,
  ]);

  const categoryItems = useMemo(
    () => categoryBreakdown?.items || [],
    [categoryBreakdown]
  );
  const categoryTotal = useMemo(() => {
    const baseCurrency =
      categoryBreakdown?.range?.baseCurrency ||
      merchantBreakdown?.range?.baseCurrency ||
      null;
    return sumIn(categoryItems.map((item) => item.value), baseCurrency);
  }, [categoryItems, categoryBreakdown, merchantBreakdown]);
  const formattedTrendData = useMemo(() => {
    if (!trendData?.series?.length) return [];
    return [
      {
        id: selectedMerchant?.label || "Merchant spend",
        data: trendData.series.map((point) => ({
          x: point.date,
          y: toMoneyNumber(point.current),
        })),
      },
    ];
  }, [trendData, selectedMerchant]);

  // Effects
  useEffect(() => {
    if (range !== "custom") return;
    setCustomFrom((prev) => prev || monthRange.from);
    setCustomTo((prev) => prev || monthRange.to);
  }, [range, monthRange.from, monthRange.to]);

  useEffect(() => {
    if (filteredItems.length === 0) {
      setSelectedMerchantId(null);
      return;
    }
    const hasSelection = filteredItems.some(
      (item) => (item.entityId || item.id) === selectedMerchantId
    );
    if (!selectedMerchantId || !hasSelection) {
      const first =
        filteredItems.find(
          (item) => (item.entityId || item.id) !== NO_MERCHANT_ID
        ) ?? filteredItems[0];
      setSelectedMerchantId(first.entityId || first.id);
    }
  }, [filteredItems, selectedMerchantId]);

  return {
    // Filter state
    filters: {
      search,
      onSearchChange: setSearch,
      minSpend,
      onMinSpendChange: setMinSpend,
      maxSpend,
      onMaxSpendChange: setMaxSpend,
      range,
      onRangeChange: setRange,
      customFrom,
      onCustomFromChange: setCustomFrom,
      customTo,
      onCustomToChange: setCustomTo,
      categoryFilter,
      onCategoryFilterChange: setCategoryFilter,
      categoryOptions,
      limit,
      onLimitChange: setLimit,
      sort,
      onSortChange: setSort,
    },
    // Data
    items: filteredItems,
    categoryItems,
    trendData: formattedTrendData,
    total,
    categoryTotal,
    dateRange,
    // Selection
    selectedMerchantId,
    selectedMerchantLabel: selectedMerchant?.label || null,
    onMerchantSelect: setSelectedMerchantId,
    // Loading states
    isLoading: isLoadingMerchants,
    isCategoryLoading: isLoadingCategories,
    isTrendLoading: isLoadingTrend,
  };
}
