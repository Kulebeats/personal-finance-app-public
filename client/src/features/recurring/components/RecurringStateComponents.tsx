/**
 * RecurringLoadingState and RecurringErrorState Components
 */

import { Card } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export function RecurringLoadingState() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <p className="text-muted-foreground">
          Loading recurring transactions...
        </p>
      </div>
    </div>
  );
}

interface RecurringErrorStateProps {
  error: Error;
  onRetry: () => void;
}

export function RecurringErrorState({
  error,
  onRetry,
}: RecurringErrorStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="p-6 max-w-md text-center">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">
          Failed to load recurring transactions
        </h2>
        <p className="text-muted-foreground mb-4">{error.message}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Retry
        </button>
      </Card>
    </div>
  );
}
