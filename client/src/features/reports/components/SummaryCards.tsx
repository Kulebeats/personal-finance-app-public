/**
 * SummaryCards Component
 *
 * Displays income, expenses, net income, and savings rate cards
 */

import { Card } from "@/components/ui/card";
import { formatCurrency, formatPercentage } from "../utils/reportFormatters";
import type { MoneyDto } from "@shared/money";
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

export interface SummaryTotals {
  income: MoneyDto;
  expenses: MoneyDto;
  savings: MoneyDto;
  savingsRate: number;
}

interface SummaryCardsProps {
  /** Null until the report arrives: the cards show "—", never a guessed currency. */
  totals: SummaryTotals | null;
}

const UNKNOWN = "—";
const amountOf = (value: MoneyDto | undefined) => (value ? formatCurrency(value, value.currency) : UNKNOWN);

export function SummaryCards({ totals }: SummaryCardsProps) {
  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-busy={totals === null}>
        <Card className="p-6 flex flex-col items-center justify-center shadow-sm text-center">
          <div
            className="font-bold text-xl mb-1"
            style={{ color: INCOME_COLOR }}
          >
            {amountOf(totals?.income)}
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
            {amountOf(totals?.expenses)}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
            Total Expenses
          </div>
        </Card>
        <Card className="p-6 flex flex-col items-center justify-center shadow-sm text-center">
          <div className="text-foreground font-bold text-xl mb-1">
            {amountOf(totals?.savings)}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
            Total Net Income
            <Tooltip>
              <TooltipTrigger type="button" aria-label="About Total Net Income" className="max-md:inline-flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center">
                <Info className="w-3 h-3 cursor-help" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Income minus Expenses</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </Card>
        <Card className="p-6 flex flex-col items-center justify-center shadow-sm text-center">
          <div className="text-foreground font-bold text-xl mb-1">
            {totals ? formatPercentage(totals.savingsRate) : UNKNOWN}
          </div>
          <div className="text-xs text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
            Savings Rate
            <Tooltip>
              <TooltipTrigger type="button" aria-label="About Savings Rate" className="max-md:inline-flex max-md:h-11 max-md:w-11 max-md:items-center max-md:justify-center">
                <Info className="w-3 h-3 cursor-help" aria-hidden="true" />
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
