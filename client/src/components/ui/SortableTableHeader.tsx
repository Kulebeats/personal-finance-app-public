/**
 * SortableTableHeader - Accessible sortable table header
 * WCAG 2.1 AA compliant with keyboard support
 */
import { cn } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

interface SortableTableHeaderProps {
  children: React.ReactNode;
  sortKey: string;
  currentSort: string | null;
  sortDirection: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
}

export function SortableTableHeader({
  children,
  sortKey,
  currentSort,
  sortDirection,
  onSort,
  className,
}: SortableTableHeaderProps) {
  const isActive = currentSort === sortKey;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSort(sortKey);
    }
  };

  return (
    <th className={cn("p-0", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        onKeyDown={handleKeyDown}
        aria-sort={
          isActive
            ? sortDirection === "asc"
              ? "ascending"
              : "descending"
            : "none"
        }
        className={cn(
          "flex items-center gap-1 w-full h-full px-4 py-3",
          "text-left font-medium text-muted-foreground",
          "hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset",
          "transition-colors cursor-pointer",
        )}
      >
        {children}
        {isActive ? (
          sortDirection === "asc" ? (
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="h-4 w-4 opacity-50" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}
