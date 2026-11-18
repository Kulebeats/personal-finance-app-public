/**
 * Budget State Components
 *
 * Reusable loading, error, and empty states for Budget page.
 */

import { Card } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

interface BudgetLoadingStateProps {
  message?: string;
}

export function BudgetLoadingState({
  message = "Loading budgets...",
}: BudgetLoadingStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

interface BudgetErrorStateProps {
  error: Error;
  onRetry: () => void;
}

export function BudgetErrorState({ error, onRetry }: BudgetErrorStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="p-6 max-w-md text-center">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
        <h2 className="text-lg font-semibold mb-2">Failed to load budgets</h2>
        <p className="text-muted-foreground mb-4">{error.message}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600"
        >
          Retry
        </button>
      </Card>
    </div>
  );
}

interface BudgetEmptyStateProps {
  onNavigateToCategories: () => void;
}

export function BudgetEmptyState({
  onNavigateToCategories,
}: BudgetEmptyStateProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="p-6 max-w-md text-center">
        <h2 className="text-lg font-semibold mb-2">
          Create categories to start budgeting
        </h2>
        <p className="text-muted-foreground mb-4">
          Budget rows are created from your categories.
        </p>
        <button
          onClick={onNavigateToCategories}
          className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600"
        >
          Go to Categories
        </button>
      </Card>
    </div>
  );
}
