import type { Dispatch, SetStateAction } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import type { TransactionFilters } from "./filtersTypes";
import { cn } from "@/lib/utils";

type FiltersOtherPanelProps = {
  draftValue: TransactionFilters;
  setDraftValue: Dispatch<SetStateAction<TransactionFilters>>;
};

export function FiltersOtherPanel({
  draftValue,
  setDraftValue,
}: FiltersOtherPanelProps) {
  return (
    <div className="p-4 space-y-6">
      <div className="space-y-3">
        <h4 className="font-medium">Transaction Type</h4>
        <div className="flex flex-wrap gap-2">
          {(["income", "expense", "transfer"] as const).map((type) => (
            <button
              key={type}
              onClick={() => {
                setDraftValue((prev) => ({
                  ...prev,
                  types: prev.types.includes(type)
                    ? prev.types.filter((item) => item !== type)
                    : [...prev.types, type],
                }));
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm border transition-colors",
                draftValue.types.includes(type)
                  ? "bg-orange-100 border-orange-500 text-orange-700"
                  : "hover:bg-muted"
              )}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="font-medium">Status</h4>
        <div className="flex flex-wrap gap-2">
          {(["pending", "cleared", "reconciled"] as const).map((status) => (
            <button
              key={status}
              onClick={() => {
                setDraftValue((prev) => ({
                  ...prev,
                  statuses: prev.statuses.includes(status)
                    ? prev.statuses.filter((item) => item !== status)
                    : [...prev.statuses, status],
                }));
              }}
              className={cn(
                "px-3 py-1.5 rounded-full text-sm border transition-colors",
                draftValue.statuses.includes(status)
                  ? "bg-orange-100 border-orange-500 text-orange-700"
                  : "hover:bg-muted"
              )}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="font-medium">Review Status</h4>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setDraftValue((prev) => ({
                ...prev,
                isReviewed: prev.isReviewed === true ? undefined : true,
              }));
            }}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm border transition-colors",
              draftValue.isReviewed === true
                ? "bg-orange-100 border-orange-500 text-orange-700"
                : "hover:bg-muted"
            )}
          >
            Reviewed
          </button>
          <button
            onClick={() => {
              setDraftValue((prev) => ({
                ...prev,
                isReviewed: prev.isReviewed === false ? undefined : false,
              }));
            }}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm border transition-colors",
              draftValue.isReviewed === false
                ? "bg-orange-100 border-orange-500 text-orange-700"
                : "hover:bg-muted"
            )}
          >
            Needs Review
          </button>
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="font-medium">Exclusions</h4>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="exclude-reports"
              checked={draftValue.isExcludedFromReports === true}
              onCheckedChange={(checked) => {
                setDraftValue((prev) => ({
                  ...prev,
                  isExcludedFromReports: checked ? true : undefined,
                }));
              }}
            />
            <label htmlFor="exclude-reports" className="text-sm cursor-pointer">
              Excluded from reports
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="exclude-budget"
              checked={draftValue.isExcludedFromBudget === true}
              onCheckedChange={(checked) => {
                setDraftValue((prev) => ({
                  ...prev,
                  isExcludedFromBudget: checked ? true : undefined,
                }));
              }}
            />
            <label htmlFor="exclude-budget" className="text-sm cursor-pointer">
              Excluded from budget
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
