import type { Dispatch, SetStateAction } from "react";

import { Input } from "@/components/ui/input";
import { parseMoneyInputNumber } from "@/lib/money";
import type { TransactionFilters } from "./filtersTypes";

type FiltersAmountPanelProps = {
  draftValue: TransactionFilters;
  setDraftValue: Dispatch<SetStateAction<TransactionFilters>>;
};

export function FiltersAmountPanel({
  draftValue,
  setDraftValue,
}: FiltersAmountPanelProps) {
  return (
    <div className="p-4 space-y-4">
      <h4 className="font-medium">Amount Range</h4>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Minimum</label>
          <Input
            type="number"
            placeholder="0.00"
            value={draftValue.amountMin ?? ""}
            onChange={(event) =>
              setDraftValue((prev) => ({
                ...prev,
                amountMin:
                  parseMoneyInputNumber(event.target.value) ?? undefined,
              }))
            }
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-muted-foreground">Maximum</label>
          <Input
            type="number"
            placeholder="No limit"
            value={draftValue.amountMax ?? ""}
            onChange={(event) =>
              setDraftValue((prev) => ({
                ...prev,
                amountMax:
                  parseMoneyInputNumber(event.target.value) ?? undefined,
              }))
            }
          />
        </div>
      </div>
    </div>
  );
}
