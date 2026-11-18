import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/format";
import { DollarSign } from "lucide-react";

type StandardViewProps = {
  income: number;
  expenses: number;
  netFlow: number;
  transactionCount: number;
  netFlowColor: string;
};

type DetailViewProps = {
  income: number;
  expenses: number;
  transactionCount: number;
  largestTransaction: number;
  largestExpense: number;
  averageTransaction: number;
  firstTransactionDate?: string | null;
  lastTransactionDate?: string | null;
};

type ChartViewProps = {
  income: number;
  expenses: number;
  netFlow: number;
  netFlowColor: string;
};

function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", valueClass)}>{value}</span>
    </div>
  );
}

export function SummaryStandardView({
  income,
  expenses,
  netFlow,
  transactionCount,
  netFlowColor,
}: StandardViewProps) {
  return (
    <>
      <div className="text-xs text-muted-foreground">
        {transactionCount}{" "}
        {transactionCount === 1 ? "transaction" : "transactions"}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          Income
        </div>
        <div className="text-xl font-bold text-green-600">
          {formatCurrency(income)}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          Expenses
        </div>
        <div className="text-xl font-bold text-red-600">
          {formatCurrency(expenses)}
        </div>
      </div>

      <div className="border-t" />

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <DollarSign className="w-3 h-3" />
          Net Flow
        </div>
        <div className={cn("text-2xl font-bold", netFlowColor)}>
          {netFlow >= 0 ? "+" : ""}
          {formatCurrency(netFlow)}
        </div>
      </div>

      {income > 0 || expenses > 0 ? (
        <div className="space-y-2 pt-2">
          <div className="h-2 rounded-full overflow-hidden bg-muted flex">
            {income > 0 && (
              <div
                className="bg-green-500 h-full transition-all"
                style={{
                  width: `${(income / (income + Math.abs(expenses))) * 100}%`,
                }}
              />
            )}
            {expenses > 0 && (
              <div
                className="bg-red-500 h-full transition-all"
                style={{
                  width: `${
                    (Math.abs(expenses) / (income + Math.abs(expenses))) * 100
                  }%`,
                }}
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function SummaryDetailView({
  income,
  expenses,
  transactionCount,
  largestTransaction,
  largestExpense,
  averageTransaction,
  firstTransactionDate,
  lastTransactionDate,
}: DetailViewProps) {
  return (
    <div className="space-y-3">
      <StatRow
        label="Total transactions"
        value={transactionCount.toLocaleString()}
      />
      <StatRow
        label="Largest transaction"
        value={`+${formatCurrency(largestTransaction)}`}
        valueClass="text-green-600"
      />
      <StatRow
        label="Largest expense"
        value={formatCurrency(largestExpense)}
      />
      <StatRow
        label="Average transaction"
        value={`${averageTransaction >= 0 ? "+" : ""}${formatCurrency(
          averageTransaction
        )}`}
        valueClass={averageTransaction >= 0 ? "text-green-600" : "text-red-600"}
      />
      <StatRow
        label="Total income"
        value={`+${formatCurrency(income)}`}
        valueClass="text-green-600"
      />
      <StatRow label="Total spending" value={formatCurrency(expenses)} />
      <div className="border-t my-2" />
      <StatRow
        label="First transaction"
        value={firstTransactionDate ? formatDate(firstTransactionDate) : "N/A"}
      />
      <StatRow
        label="Last transaction"
        value={lastTransactionDate ? formatDate(lastTransactionDate) : "N/A"}
      />

      <Button variant="link" className="text-blue-600 h-auto p-0 mt-2">
        Download CSV
      </Button>
    </div>
  );
}

export function SummaryChartView({
  income,
  expenses,
  netFlow,
  netFlowColor,
}: ChartViewProps) {
  const total = income + expenses;
  const incomePct = total > 0 ? (income / total) * 100 : 0;
  const expensePct = total > 0 ? (expenses / total) * 100 : 0;

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div
        className="relative w-32 h-32 rounded-full flex items-center justify-center shadow-inner"
        style={{
          background: `conic-gradient(#22c55e ${incomePct}%, #ef4444 ${incomePct}% 100%)`,
        }}
      >
        <div className="absolute w-20 h-20 bg-background rounded-full flex items-center justify-center flex-col">
          <span className="text-[10px] text-muted-foreground">Net</span>
          <span className={cn("text-sm font-bold", netFlowColor)}>
            {formatCurrency(netFlow)}
          </span>
        </div>
      </div>

      <div className="w-full space-y-2">
        <div className="flex justify-between items-center text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span>Income</span>
          </div>
          <span className="font-bold text-green-600">
            {formatCurrency(income)}
          </span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span>Expenses</span>
          </div>
          <span className="font-bold text-red-600">
            {formatCurrency(expenses)}
          </span>
        </div>
      </div>
    </div>
  );
}
