import { DollarSign, Percent, TrendingDown, TrendingUp } from "lucide-react";

export type TransactionType = "buy" | "sell" | "dividend" | "interest";

export const TRANSACTION_TYPE_OPTIONS = [
  {
    value: "buy",
    label: "Buy",
    icon: TrendingUp,
    color: "text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "sell",
    label: "Sell",
    icon: TrendingDown,
    color: "text-rose-600 dark:text-rose-400",
  },
  {
    value: "dividend",
    label: "Dividend",
    icon: DollarSign,
    color: "text-blue-600 dark:text-blue-400",
  },
  {
    value: "interest",
    label: "Interest",
    icon: Percent,
    color: "text-amber-600 dark:text-amber-400",
  },
] as const;
