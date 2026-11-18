import { cn } from "@/lib/utils";

import {
  TRANSACTION_TYPE_OPTIONS,
  type TransactionType,
} from "./InvestmentTransactionTypes";

type InvestmentTransactionTypeSelectorProps = {
  transactionType: TransactionType;
  onChange: (value: TransactionType) => void;
};

export function InvestmentTransactionTypeSelector({
  transactionType,
  onChange,
}: InvestmentTransactionTypeSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {TRANSACTION_TYPE_OPTIONS.map((type) => (
          <button
            key={type.value}
            type="button"
            onClick={() => onChange(type.value)}
            className={cn(
              "flex flex-col items-center gap-1 p-3 rounded-lg border transition-all",
              transactionType === type.value
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50"
            )}
          >
            <type.icon className={cn("w-5 h-5", type.color)} />
            <span className="text-xs font-medium">{type.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
