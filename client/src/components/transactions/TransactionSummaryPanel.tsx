import { useMemo, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SummaryStandardView,
  SummaryDetailView,
  SummaryChartView,
} from "./TransactionSummaryViews";

interface TransactionSummaryPanelProps {
  income: number;
  expenses: number;
  netFlow: number;
  transactionCount: number;
  largestTransaction?: number;
  largestExpense?: number;
  averageTransaction?: number;
  firstTransactionDate?: string | null;
  lastTransactionDate?: string | null;
  isCollapsed: boolean;
  onToggle: () => void;
  className?: string;
}

export function TransactionSummaryPanel({
  income,
  expenses,
  netFlow,
  transactionCount,
  largestTransaction = 0,
  largestExpense = 0,
  averageTransaction = 0,
  firstTransactionDate,
  lastTransactionDate,
  isCollapsed,
  onToggle,
  className,
}: TransactionSummaryPanelProps) {
  const [currentView, setCurrentView] = useState(0);

  const netFlowColor = useMemo(() => {
    if (netFlow > 0) return "text-green-600";
    if (netFlow < 0) return "text-red-600";
    return "text-muted-foreground";
  }, [netFlow]);

  const netFlowBg = useMemo(() => {
    if (netFlow > 0) return "bg-green-500/10";
    if (netFlow < 0) return "bg-red-500/10";
    return "bg-muted/50";
  }, [netFlow]);

  const nextView = () => setCurrentView((prev) => (prev + 1) % 3);
  const prevView = () => setCurrentView((prev) => (prev - 1 + 3) % 3);

  if (isCollapsed) {
    return (
      <div className={cn("flex flex-col gap-2 w-12 sticky top-24", className)}>
        <div className="flex flex-col gap-2 items-center">
          <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-green-600" />
          </div>
          <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
            <TrendingDown className="w-4 h-4 text-red-600" />
          </div>
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center",
              netFlowBg
            )}
          >
            <DollarSign className={cn("w-4 h-4", netFlowColor)} />
          </div>
        </div>
      </div>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 0: // Standard View
        return (
          <SummaryStandardView
            income={income}
            expenses={expenses}
            netFlow={netFlow}
            transactionCount={transactionCount}
            netFlowColor={netFlowColor}
          />
        );

      case 1: // Detailed View
        return (
          <SummaryDetailView
            income={income}
            expenses={expenses}
            transactionCount={transactionCount}
            largestTransaction={largestTransaction}
            largestExpense={largestExpense}
            averageTransaction={averageTransaction}
            firstTransactionDate={firstTransactionDate}
            lastTransactionDate={lastTransactionDate}
          />
        );

      case 2: // Overall Chart View
        return (
          <SummaryChartView
            income={income}
            expenses={expenses}
            netFlow={netFlow}
            netFlowColor={netFlowColor}
          />
        );

      default:
        return null;
    }
  };

  return (
    <Card className={cn("w-72 p-4 sticky top-24 h-fit space-y-4", className)}>
      {/* Header with Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={prevView}
          aria-label="Previous summary view"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <h3 className="font-semibold text-sm">Summary</h3>

        {/* If we want to allow collapsing, we can put it here or as a separate absolute button?
            The mockup showed just chevrons for carousel.
            I'll keep the collapse button on the far right maybe?
            Or rely on "Hide summary" interaction.
            The previous code had text "Summary" and a collapse button.
            The mockup instructions were: "Title 'Summary' at the top with left and right chevron arrows".
            I'll assume the collapse toggle is the rightmost thing, or integrated.
            I'll put the Collapse button strictly to the right of the carousel nav?
            Actually, let's group the navigation around the title.
        */}
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={nextView}
            aria-label="Next summary view"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="pt-2">{renderView()}</div>

      {/* View Dots Indicator */}
      <div className="flex justify-center gap-1.5 pt-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              "w-1.5 h-1.5 rounded-full transition-colors",
              currentView === i ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
    </Card>
  );
}
