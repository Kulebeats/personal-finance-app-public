/**
 * MerchantsSection Component
 *
 * Complex section displaying merchant spending with filters, charts, and tables
 */

import { Card } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Loader2 } from "lucide-react";
import { toMoneyNumber, type MoneyValue } from "@/lib/money";
import { PRIMARY_CHART_COLOR } from "../utils/chartTheme";
import { formatCurrency, formatAxisValue } from "../utils/reportFormatters";
import { CHART_COLORS } from "../constants";
import { MerchantsFilters } from "./MerchantsFilters";
import { MerchantsTables } from "./MerchantsTables";
import type {
  MerchantFilters,
  MerchantItem,
  MerchantTrendSeries,
} from "./merchants.types";

interface MerchantsSectionProps {
  items: MerchantItem[];
  categoryItems: MerchantItem[];
  trendData: MerchantTrendSeries;
  total: MoneyValue;
  categoryTotal: MoneyValue;
  selectedMerchantId: string | null;
  selectedMerchantLabel: string | null;
  onMerchantSelect: (id: string) => void;
  isLoading: boolean;
  isCategoryLoading: boolean;
  isTrendLoading: boolean;
  filters: MerchantFilters;
  currency: string | null; // null until known: amounts then show without a currency
}

export function MerchantsSection({
  items,
  categoryItems,
  trendData,
  total,
  categoryTotal,
  selectedMerchantId,
  selectedMerchantLabel,
  onMerchantSelect,
  isLoading,
  isCategoryLoading,
  isTrendLoading,
  filters,
  currency,
}: MerchantsSectionProps) {
  const barData = items.slice(0, 10).map((item) => ({
    merchant: item.label,
    spend: toMoneyNumber(item.value),
  }));

  const pieData = categoryItems.map((item, index) => ({
    id: item.id,
    label: item.label,
    value: toMoneyNumber(item.value),
    color: item.color || CHART_COLORS[index % CHART_COLORS.length],
  }));
  const totalValue = toMoneyNumber(total);
  const categoryTotalValue = toMoneyNumber(categoryTotal);

  const barChartConfig: ChartConfig = {
    spend: { label: "Spend", color: PRIMARY_CHART_COLOR },
  };

  const pieChartConfig = pieData.reduce((acc, item) => {
    acc[item.id] = { label: item.label, color: item.color };
    return acc;
  }, {} as ChartConfig);

  const trendChartConfig = trendData.reduce((acc, series) => {
    acc[series.id] = { label: series.id, color: PRIMARY_CHART_COLOR };
    return acc;
  }, {} as ChartConfig);

  const trendXs = Array.from(
    new Set(trendData.flatMap((s) => s.data.map((p) => String(p.x)))),
  );
  const trendRows = trendXs.map((x) => {
    const row: Record<string, string | number> = { x };
    for (const s of trendData) {
      row[s.id] = s.data.find((p) => String(p.x) === x)?.y ?? 0;
    }
    return row;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto space-y-6">
      {/* Filters Toolbar */}
      <MerchantsFilters filters={filters} />

      {items.length === 0 ? (
        <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
          No merchant spending for this period.
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Total spend</p>
              <p className="text-lg font-semibold">
                {formatCurrency(total, currency)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Top merchant</p>
              <p className="text-lg font-semibold">{items[0]?.label || "-"}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Top share</p>
              <p className="text-lg font-semibold">
                {items[0]
                  ? (
                      (toMoneyNumber(items[0].value) / (totalValue || 1)) *
                      100
                    ).toFixed(1)
                  : "0.0"}
                %
              </p>
            </Card>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Bar Chart */}
            <div className="lg:col-span-2 h-[280px]">
              <ChartContainer
                config={barChartConfig}
                className="w-full h-full"
              >
                <BarChart
                  data={barData}
                  margin={{ top: 10, right: 20, bottom: 60, left: 60 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="merchant"
                    tickLine={false}
                    axisLine={false}
                    angle={-35}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => formatAxisValue(Number(value))}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => formatCurrency(Number(value), currency)}
                      />
                    }
                  />
                  <Bar dataKey="spend" fill={PRIMARY_CHART_COLOR} radius={4} />
                </BarChart>
              </ChartContainer>
            </div>

            {/* Category Pie */}
            <div className="rounded-lg border p-3 flex flex-col">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Spend by merchant category
              </p>
              <div className="flex-1 min-h-[220px]">
                {isCategoryLoading ? (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    Loading...
                  </div>
                ) : pieData.length > 0 ? (
                  <ChartContainer
                    config={pieChartConfig}
                    className="mx-auto w-full h-full"
                  >
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="id"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                        strokeWidth={2}
                      >
                        {pieData.map((d) => (
                          <Cell key={d.id} fill={d.color} />
                        ))}
                      </Pie>
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            nameKey="id"
                            formatter={(value) =>
                              formatCurrency(Number(value), currency)
                            }
                          />
                        }
                      />
                    </PieChart>
                  </ChartContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                    No category data.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Trend Chart */}
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Merchant spend trend
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedMerchantLabel || "Select a merchant"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">Monthly</span>
            </div>
            <div className="h-[240px]">
              {!selectedMerchantId ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Pick a merchant to view a trend.
                </div>
              ) : isTrendLoading ? (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : trendData.length > 0 ? (
                <ChartContainer
                  config={trendChartConfig}
                  className="w-full h-full"
                >
                  <LineChart
                    data={trendRows}
                    margin={{ top: 20, right: 20, bottom: 50, left: 50 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="x"
                      tickLine={false}
                      axisLine={false}
                      angle={-30}
                      textAnchor="end"
                      height={50}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => formatAxisValue(Number(value))}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          formatter={(value) => formatCurrency(Number(value), currency)}
                        />
                      }
                    />
                    {trendData.map((series) => (
                      <Line
                        key={series.id}
                        dataKey={series.id}
                        stroke={PRIMARY_CHART_COLOR}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ChartContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No trend data for this range.
                </div>
              )}
            </div>
          </div>

          <MerchantsTables
            items={items}
            categoryItems={categoryItems}
            selectedMerchantId={selectedMerchantId}
            onMerchantSelect={onMerchantSelect}
            totalValue={totalValue}
            categoryTotalValue={categoryTotalValue}
            currency={currency}
          />
        </>
      )}
    </div>
  );
}
