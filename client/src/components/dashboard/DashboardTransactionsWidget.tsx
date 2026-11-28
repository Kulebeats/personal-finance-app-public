import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ShoppingBag,
  Coffee,
  Car,
  Home,
  Smartphone,
  ChevronRight,
  Video,
  Plane,
  Loader2,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { useFormatters } from "@/contexts/SettingsContext";
import { useTransactions } from "@/hooks/useTransactions";
import { useCategories } from "@/hooks/useCategories";
import { useState } from "react";
import { toMoneyNumber } from "@/lib/money";
import { TransactionDetailModal } from "./TransactionDetailModal";
import { WidgetErrorState } from "./WidgetErrorState";

interface TransactionDisplay {
  id: string;
  name: string;
  date: string;
  amount: number;
  type: "income" | "expense" | "transfer" | "balance_adjustment";
  categoryId?: string;
  categoryName: string;
  icon: LucideIcon;
}

const ICON_MAP: Record<string, LucideIcon> = {
  Entertainment: Video,
  Travel: Plane,
  Shopping: ShoppingBag,
  Clothing: ShoppingBag,
  Auto: Car,
  Transport: Car,
  Housing: Home,
  Utilities: Smartphone,
  Food: Coffee,
  Dining: Coffee,
};

function parseLocalDate(value: string): Date {
  if (value.includes("T")) {
    return new Date(value);
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return new Date(value);
  }
  return new Date(year, month - 1, day);
}

export default function DashboardTransactionsWidget() {
  const { formatCurrency, formatDate } = useFormatters();
  const { data, isLoading, error, refetch } = useTransactions({ limit: 5 });
  const { data: categoriesData, isLoading: categoriesLoading } =
    useCategories();
  const categories = categoriesData?.categories ?? [];
  const [selectedTransaction, setSelectedTransaction] =
    useState<TransactionDisplay | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  if (isLoading) {
    return (
      <Card className="shadow-sm border-border/50 bg-card h-full flex flex-col justify-center items-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (error) {
    return (
      <WidgetErrorState
        title="Unable to load transactions"
        message="Failed to fetch recent activity."
        onRetry={() => refetch()}
        className="shadow-sm border-border/50 h-full"
      />
    );
  }

  const transactions = data?.transactions || [];

  const getIcon = (categoryName?: string) => {
    if (!categoryName) return Receipt;
    for (const [key, Icon] of Object.entries(ICON_MAP)) {
      if (categoryName.includes(key)) return Icon;
    }
    return Receipt;
  };

  const toDisplayTransaction = (transaction: (typeof transactions)[number]) => {
    const amountValue = toMoneyNumber(transaction.amount);
    const signedAmount =
      transaction.type === "expense" ? -amountValue : amountValue;
    const categoryName = transaction.categoryName || "Uncategorized";
    const Icon = getIcon(categoryName);
    const dateValue = parseLocalDate(transaction.date);

    return {
      id: transaction.id,
      name: transaction.name,
      date: formatDate(dateValue),
      amount: signedAmount,
      type: transaction.type,
      categoryId: transaction.categoryId,
      categoryName,
      icon: Icon,
    };
  };

  const handleRowClick = (transaction: (typeof transactions)[number]) => {
    setSelectedTransaction(toDisplayTransaction(transaction));
    setModalOpen(true);
  };

  return (
    <>
      <Card className="shadow-sm border-border/50 bg-card h-full">
      {/* UX-02: wraps, so "All transactions" drops below the title on a narrow card instead of leaving it. */}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-4 space-y-0">
        <div className="flex items-baseline gap-2">
          <CardTitle className="text-lg font-bold text-foreground">
            Transactions
          </CardTitle>
          <span className="text-sm text-muted-foreground">Most recent</span>
        </div>
        <Link
          href="/transactions"
          className="text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 bg-muted/30 px-3 py-1 rounded-md transition-colors"
        >
          All transactions <ChevronRight className="w-3 h-3 rotate-90" />
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border/40">
          {transactions.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No recent transactions
            </div>
          ) : (
            transactions.map((t) => {
              const Icon = getIcon(t.categoryName || undefined);
              const amount = toMoneyNumber(t.amount);
              const displayAmount =
                t.type === "expense" ? -amount : amount;
              const isIncome = t.type === "income";
              const isExpense = t.type === "expense";

              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleRowClick(t)}
                  className="flex items-center justify-between px-6 py-4 hover:bg-muted/20 transition-colors cursor-pointer group w-full text-left"
                  aria-label={`View transaction ${t.name}`}
                >
                  {/* Left: Icon + Name */}
                  <div className="flex items-center gap-4 w-[40%]">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center transition-colors flex-shrink-0",
                        "bg-muted text-muted-foreground group-hover:bg-background dark:group-hover:bg-slate-700 group-hover:shadow-sm"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="font-semibold text-foreground text-sm truncate">
                      {t.name}
                    </span>
                  </div>

                  {/* Center: Category Icon + Name */}
                  <div className="flex items-center gap-2 w-[30%] text-muted-foreground">
                    <Icon className="w-3 h-3" />
                    <span className="text-sm truncate">
                      {t.categoryName || "Uncategorized"}
                    </span>
                  </div>

                  {/* Right: Amount + Arrow */}
                  <div className="flex items-center justify-end gap-3 w-[30%]">
                    <span
                      className={cn(
                        "font-bold text-sm",
                        isIncome
                          ? "text-emerald-600 dark:text-emerald-400"
                          : isExpense
                          ? "text-foreground"
                          : "text-muted-foreground"
                      )}
                    >
                      {isIncome ? "+" : ""}
                      {formatCurrency(displayAmount)}
                    </span>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </CardContent>
      </Card>

      <TransactionDetailModal
        transaction={selectedTransaction}
        open={modalOpen}
        onOpenChange={setModalOpen}
        categories={categories}
        categoriesLoading={categoriesLoading}
      />
    </>
  );
}
