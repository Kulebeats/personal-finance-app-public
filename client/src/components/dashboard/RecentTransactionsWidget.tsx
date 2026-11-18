import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ShoppingBag,
  Coffee,
  Car,
  Home,
  Smartphone,
  ArrowRight,
  DollarSign,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useState, useMemo } from "react";
import { TransactionDetailModal } from "./TransactionDetailModal";
import { Link } from "wouter";
import { useTransactions } from "@/hooks/use-finance-data";
import { useCategories } from "@/hooks/useCategories";
import { useFormatters } from "@/contexts/SettingsContext";

/**
 * Display representation of a transaction for the widget
 */
interface TransactionDisplay {
  id: string;
  name: string;
  date: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  categoryId?: string;
  categoryName: string;
  icon: LucideIcon;
}

const categoryIcons: Record<string, LucideIcon> = {
  Groceries: ShoppingBag,
  "Food & Dining": Coffee,
  Transportation: Car,
  Housing: Home,
  Salary: Smartphone,
  default: DollarSign,
};

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return new Date(value);
  }
  return new Date(year, month - 1, day);
}

function toLocalDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
}

export default function RecentTransactionsWidget() {
  const [selectedTransaction, setSelectedTransaction] =
    useState<TransactionDisplay | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { transactions: allTransactions, loading: transactionsLoading } =
    useTransactions();
  const { data: categoriesData, isLoading: categoriesLoading } =
    useCategories();
  const { formatCurrency } = useFormatters();
  const categories = categoriesData?.categories ?? [];
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );

  // Get recent transactions sorted by date
  const transactions = useMemo<TransactionDisplay[]>(() => {
    return [...allTransactions]
      .sort(
        (a, b) =>
          parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime()
      )
      .slice(0, 5)
      .map((t) => {
        const category = categoryById.get(t.category);
        const categoryName =
          category?.name ||
          (t.category === "Uncategorized" ? "Uncategorized" : "Category");
        const Icon = categoryIcons[categoryName] || categoryIcons["default"];
        const today = toLocalDateKey(new Date());
        const yesterday = toLocalDateKey(new Date(Date.now() - 86400000));
        let dateDisplay: string;
        if (t.date === today) {
          dateDisplay = "Today";
        } else if (t.date === yesterday) {
          dateDisplay = "Yesterday";
        } else {
          dateDisplay = parseLocalDate(t.date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
        }

        return {
          id: t.id,
          name: t.description,
          date: dateDisplay,
          amount: t.type === "expense" ? -t.amount : t.amount,
          type: t.type,
          categoryId: category?.id ?? (t.category !== "Uncategorized" ? t.category : undefined),
          categoryName,
          icon: Icon,
        };
      });
  }, [allTransactions, categoryById]);

  const handleRowClick = (t: TransactionDisplay) => {
    setSelectedTransaction(t);
    setModalOpen(true);
  };

  const handleRowKeyDown = (e: React.KeyboardEvent, t: TransactionDisplay) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowClick(t);
    }
  };

  return (
    <>
      <Card className="col-span-2 shadow-sm border-border/50 bg-card hover:shadow-md transition-shadow duration-300">
        <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/40">
          <CardTitle className="text-base font-semibold text-foreground">
            Recent Transactions
          </CardTitle>
          <Link href="/transactions">
            <div className="text-primary text-sm font-medium hover:underline flex items-center gap-1 cursor-pointer">
              View All <ArrowRight className="w-4 h-4" />
            </div>
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {transactionsLoading ? (
            <div className="flex items-center justify-center h-[200px] text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No transactions yet. Add your first transaction!
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {transactions.map((t, i) => {
                const IconComponent = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={cn(
                      "flex items-center justify-between px-4 h-[56px] w-full text-left",
                      "hover:bg-muted/50 transition-colors cursor-pointer group",
                      "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset",
                      i % 2 === 0 ? "bg-transparent" : "bg-muted/10"
                    )}
                    onClick={() => handleRowClick(t)}
                    onKeyDown={(e) => handleRowKeyDown(e, t)}
                  >
                    {/* Left: Merchant + Date */}
                    <div className="flex flex-col justify-center w-[35%]">
                      <div className="font-medium text-foreground text-sm truncate">
                        {t.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t.date}
                      </div>
                    </div>

                    {/* Center: Category Icon + Name */}
                    <div className="flex items-center justify-start gap-2 w-[35%]">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0",
                          t.type === "income"
                            ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground group-hover:bg-background dark:group-hover:bg-slate-700 group-hover:shadow-sm"
                        )}
                      >
                        <IconComponent className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-sm text-muted-foreground truncate">
                        {t.categoryName}
                      </span>
                    </div>

                    {/* Right: Amount */}
                    <div
                      className={cn(
                        "font-bold text-base text-right w-[30%]",
                        t.type === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
                      )}
                    >
                      {t.type === "income" ? "+" : ""}
                      {formatCurrency(t.amount)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
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
