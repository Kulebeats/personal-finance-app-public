/**
 * ChartA11yToggle Component
 *
 * Provides a toggle to switch between chart and table views for accessibility.
 * Uses proper ARIA attributes for screen readers.
 */

import { Table, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChartA11yToggleProps {
  showTable: boolean;
  onToggle: (showTable: boolean) => void;
  tableId: string;
  className?: string;
}

export function ChartA11yToggle({
  showTable,
  onToggle,
  tableId,
  className,
}: ChartA11yToggleProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onToggle(!showTable)}
      aria-expanded={showTable}
      aria-controls={tableId}
      className={cn(
        "gap-2 text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {showTable ? (
        <>
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
          <span>View as chart</span>
        </>
      ) : (
        <>
          <Table className="h-4 w-4" aria-hidden="true" />
          <span>View as table</span>
        </>
      )}
    </Button>
  );
}
