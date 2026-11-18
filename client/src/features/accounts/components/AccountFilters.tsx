import { Plus, RefreshCw } from "lucide-react";
import { OwnerFilter } from "@/components/OwnerFilter"; // Keeping shared component import
import { AddAccountModal } from "./AddAccountModal";
import { Button } from "@/components/ui/button";

interface AccountFiltersProps {
  ownerUserId: string | null;
  onOwnerChange: (val: string | null) => void;
  onRefresh: () => void;
}

export function AccountFilters({
  ownerUserId,
  onOwnerChange,
  onRefresh,
}: AccountFiltersProps) {
  return (
    <div className="flex items-center gap-4 ml-auto">
      <div className="w-[200px]">
        <OwnerFilter
          value={ownerUserId}
          onChange={(val) => onOwnerChange(val as string | null)}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRefresh}
        aria-label="Refresh all account balances"
      >
        <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh all
      </Button>
      <AddAccountModal>
        <Button
          type="button"
          size="sm"
          aria-label="Add a new account"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Add account
        </Button>
      </AddAccountModal>
    </div>
  );
}
