/**
 * UnavailableBudgetsNotice
 *
 * Names each budget the server could not report for this month and says why
 * (C3-10). Such a budget has no row and no amount on the page; this notice
 * keeps it from silently looking unbudgeted.
 */

import { AlertTriangle } from "lucide-react";
import type { UnavailableBudget } from "@/hooks/useUnavailableBudgets";

interface UnavailableBudgetsNoticeProps {
  budgets: ReadonlyArray<UnavailableBudget>;
}

export function UnavailableBudgetsNotice({ budgets }: UnavailableBudgetsNoticeProps) {
  if (budgets.length === 0) return null;
  return (
    <section
      role="status"
      aria-label="Budgets not shown this month"
      className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {budgets.length === 1 ? "1 budget is not shown this month" : `${budgets.length} budgets are not shown this month`}
      </div>
      <ul className="mt-2 space-y-1">
        {budgets.map((budget) => (
          <li key={budget.id}>
            <span className="font-medium">{budget.name}</span>: {budget.reason.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
