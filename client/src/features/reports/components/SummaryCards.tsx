/**
 * SummaryCards Component
 *
 * Displays income, expenses, net income, and savings rate cards
 */

import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercentage } from "../utils/reportFormatters";
import type { MoneyValue } from "@shared/money";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import {
  INCOME_COLOR,
  EXPENSE_COLOR,
  NET_WORTH_COLOR,
} from "../utils/chartTheme";

interface SummaryCardsProps {
  income: MoneyValue;
  expenses: MoneyValue;
  savings: MoneyValue;
  savingsRate: number;
  currency?: string;
}

export function SummaryCards({
  income,
  expenses,
  savings,
  savingsRate,
  currency = "USD",
}: SummaryCardsProps) {
  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-6 flex flex-col items-center justify-center shadow-sm text-center">
          <div
            className="font-bold text-xl mb-1"
            style={{ color: INCOME_COLOR }}
          >
            {formatCurrency(income, currency)}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
            Total Income
          </div>
        </Card>
        <Card className="p-6 flex flex-col items-center justify-center shadow-sm text-center">
          <div
            className="font-bold text-xl mb-1"
            style={{ color: EXPENSE_COLOR }}
          >
            {formatCurrency(expenses, currency)}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
            Total Expenses
          </div>
        </Card>
        <Card className="p-6 flex flex-col items-center justify-center shadow-sm text-center">
          <div className="text-foreground font-bold text-xl mb-1">
            {formatCurrency(savings, currency)}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
            Total Net Income
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-3 h-3 cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Income minus Expenses</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </Card>
        <Card className="p-6 flex flex-col items-center justify-center shadow-sm text-center">
          <div className="text-foreground font-bold text-xl mb-1">
            {formatPercentage(savingsRate)}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
            Savings Rate
            <Tooltip>
              <TooltipTrigger>
                <Info className="w-3 h-3 cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Percentage of income saved</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </Card>
      </div>
    </TooltipProvider>
  );
}
