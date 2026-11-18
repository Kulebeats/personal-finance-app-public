import type { TransactionFilters } from "./filtersTypes";

type FiltersSummaryPanelProps = {
  draftValue: TransactionFilters;
  totalFiltersCount: number;
};

export function FiltersSummaryPanel({
  draftValue,
  totalFiltersCount,
}: FiltersSummaryPanelProps) {
  return (
    <div className="w-56 border-l bg-muted/30 p-4">
      <div className="text-sm font-medium mb-3">
        {totalFiltersCount} {totalFiltersCount === 1 ? "filter" : "filters"} selected
      </div>
      <div className="space-y-2">
        {draftValue.categoryIds.length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Categories:</span>{" "}
            {draftValue.categoryIds.length}
          </div>
        )}
        {draftValue.accountIds.length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Accounts:</span>{" "}
            {draftValue.accountIds.length}
          </div>
        )}
        {draftValue.goalIds.length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Goals:</span>{" "}
            {draftValue.goalIds.length}
          </div>
        )}
        {draftValue.tagIds.length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Tags:</span>{" "}
            {draftValue.tagIds.length}
          </div>
        )}
        {draftValue.types.length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Types:</span>{" "}
            {draftValue.types.join(", ")}
          </div>
        )}
        {draftValue.statuses.length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">Statuses:</span>{" "}
            {draftValue.statuses.join(", ")}
          </div>
        )}
        {(draftValue.amountMin !== undefined ||
          draftValue.amountMax !== undefined) && (
          <div className="text-sm">
            <span className="text-muted-foreground">Amount:</span>{" "}
            {draftValue.amountMin ?? 0} - {draftValue.amountMax ?? "No limit"}
          </div>
        )}
      </div>
    </div>
  );
}
