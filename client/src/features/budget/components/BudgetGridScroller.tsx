/**
 * BudgetGridScroller
 *
 * The budget page's 12-column grid: its column header, then the sections
 * passed as children. Below md the grid keeps a readable width and scrolls
 * sideways, so its columns never overlap on a phone.
 */

import type { ReactNode } from "react";

interface BudgetGridScrollerProps {
  children: ReactNode;
}

export function BudgetGridScroller({ children }: BudgetGridScrollerProps) {
  return (
    <div className="max-md:overflow-x-auto">
      <div className="max-md:min-w-[40rem]">
        <div className="grid grid-cols-12 gap-4 py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border mb-2">
          <div className="col-span-5">Category</div>
          <div className="col-span-3 text-right pr-4">Budget</div>
          <div className="col-span-2 text-right pr-8">Actual</div>
          <div className="col-span-2 text-right">Remaining</div>
        </div>
        {children}
      </div>
    </div>
  );
}
