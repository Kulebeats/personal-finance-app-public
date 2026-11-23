import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Decimal from "decimal.js";
import { getCurrencySymbol, formatDate } from "@/lib/format";
import { DollarSign } from "lucide-react";

export type SummaryAmount = number | string;
const SummaryDecimal = Decimal.clone({ precision: 40 });

type StandardViewProps = {
  income: SummaryAmount;
  expenses: SummaryAmount;
  netFlow: SummaryAmount;
  transactionCount: number;
  netFlowColor: string;
  currency?: string;
};

type DetailViewProps = {
  income: SummaryAmount;
  expenses: SummaryAmount;
  transactionCount: number;
  currency?: string;
  largestTransaction?: SummaryAmount | null;
  largestExpense?: SummaryAmount | null;
  averageTransaction?: SummaryAmount | null;
  firstTransactionDate?: string | null;
  lastTransactionDate?: string | null;
};

type ChartViewProps = {
  income: SummaryAmount;
  expenses: SummaryAmount;
  netFlow: SummaryAmount;
  netFlowColor: string;
  currency?: string;
};

function formatSummaryCurrency(value: SummaryAmount, currency: string) {
  const amount = new SummaryDecimal(value);
  const [integer, fraction] = amount.abs().toFixed(2).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amount.isNegative() && !amount.isZero() ? "-" : ""}${getCurrencySymbol(currency)}${grouped}.${fraction}`;
}

function formatOptionalAmount(value: SummaryAmount | null | undefined, currency: string, signed = false) {
  if (value === null) return "N/A";
  if (value === undefined) return "Unavailable";
  const amount = new SummaryDecimal(value);
  if (!amount.isFinite()) return "Unavailable";
  return `${signed && amount.greaterThanOrEqualTo(0) ? "+" : ""}${formatSummaryCurrency(value, currency)}`;
}

function formatSummaryDate(value: string | null | undefined) {
  if (value === undefined) return "Unavailable";
  if (value === null) return "N/A";
  // API calendar dates must not shift when the browser parses a UTC midnight.
  return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : value);
}
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
  currency = "ZMW",
}: StandardViewProps) {
  const incomeAmount = new SummaryDecimal(income), expenseAmount = new SummaryDecimal(expenses);
  const total = incomeAmount.plus(expenseAmount.abs());
  const incomePct = total.greaterThan(0) ? incomeAmount.dividedBy(total).times(100).toNumber() : 0;
  const expensePct = total.greaterThan(0) ? expenseAmount.abs().dividedBy(total).times(100).toNumber() : 0;
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
          {formatSummaryCurrency(income, currency)}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          Expenses
        </div>
        <div className="text-xl font-bold text-red-600">
          {formatSummaryCurrency(expenses, currency)}
        </div>
      </div>

      <div className="border-t" />

      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <DollarSign className="w-3 h-3" />
          Net Flow
        </div>
        <div className={cn("text-2xl font-bold", netFlowColor)}>
          {new SummaryDecimal(netFlow).greaterThanOrEqualTo(0) ? "+" : ""}
          {formatSummaryCurrency(netFlow, currency)}
        </div>
      </div>

      {incomeAmount.greaterThan(0) || expenseAmount.greaterThan(0) ? (
        <div className="space-y-2 pt-2">
          <div className="h-2 rounded-full overflow-hidden bg-muted flex">
            {incomeAmount.greaterThan(0) && (
              <div
                className="bg-green-500 h-full transition-all"
                style={{
                  width: `${incomePct}%`,
                }}
              />
            )}
            {expenseAmount.greaterThan(0) && (
              <div
                className="bg-red-500 h-full transition-all"
                style={{
                  width: `${
                    expensePct
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
  currency = "ZMW",
}: DetailViewProps) {
  return (
    <div className="space-y-3">
      <StatRow
        label="Total transactions"
        value={transactionCount.toLocaleString()}
      />
      <StatRow
        label="Largest income"
        value={formatOptionalAmount(largestTransaction, currency, true)}
        valueClass="text-green-600"
      />
      <StatRow
        label="Largest expense"
        value={formatOptionalAmount(largestExpense, currency)}
      />
      <StatRow
        label="Average transaction"
        value={formatOptionalAmount(averageTransaction, currency, true)}
        valueClass={averageTransaction == null ? "text-muted-foreground"
          : new SummaryDecimal(averageTransaction).greaterThanOrEqualTo(0) ? "text-green-600" : "text-red-600"}
      />
      <StatRow
        label="Total income"
        value={`+${formatSummaryCurrency(income, currency)}`}
        valueClass="text-green-600"
      />
      <StatRow label="Total spending" value={formatSummaryCurrency(expenses, currency)} />
      <div className="border-t my-2" />
      <StatRow
        label="First transaction"
        value={formatSummaryDate(firstTransactionDate)}
      />
      <StatRow
        label="Last transaction"
        value={formatSummaryDate(lastTransactionDate)}
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
  currency = "ZMW",
}: ChartViewProps) {
  const total = new SummaryDecimal(income).plus(expenses);
  const incomePct = total.greaterThan(0) ? new SummaryDecimal(income).dividedBy(total).times(100).toNumber() : 0;

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div
        className="relative w-32 h-32 rounded-full flex items-center justify-center shadow-inner"
        style={{
          background: total.greaterThan(0) ? `conic-gradient(#22c55e ${incomePct}%, #ef4444 ${incomePct}% 100%)` : "hsl(var(--muted))",
        }}
      >
        <div className="absolute w-20 h-20 bg-background rounded-full flex items-center justify-center flex-col">
          <span className="text-[10px] text-muted-foreground">Net</span>
          <span className={cn("text-sm font-bold", netFlowColor)}>
            {formatSummaryCurrency(netFlow, currency)}
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
            {formatSummaryCurrency(income, currency)}
          </span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span>Expenses</span>
          </div>
          <span className="font-bold text-red-600">
            {formatSummaryCurrency(expenses, currency)}
          </span>
        </div>
      </div>
    </div>
  );
}
