import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface CashflowMetadata {
  currencyMode: "household" | "mixed";
  baseCurrency: string;
  generatedAt: string;
  forecastConfig?: {
    enabled: boolean;
    horizonMonths: number;
    dataSourcesUsed: ("recurring" | "budgets" | "averages")[];
  };
}

interface CurrencyWarningProps {
  metadata: CashflowMetadata;
}

export function CurrencyWarning({ metadata }: CurrencyWarningProps) {
  if (metadata.currencyMode !== "mixed") return null;

  return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle>Multi-Currency Data Aggregated</AlertTitle>
      <AlertDescription>
        This report includes transactions in multiple currencies. All amounts
        have been converted to {metadata.baseCurrency} using historical exchange
        rates for accurate comparison.
      </AlertDescription>
    </Alert>
  );
}
