import { Plus, RefreshCw } from "lucide-react";
import { OwnerFilter } from "@/components/OwnerFilter"; // Keeping shared component import
import { Button } from "@/components/ui/button";

interface AccountFiltersProps {
  ownerUserId: string | null;
  onOwnerChange: (val: string | null) => void;
  onRefresh: () => void;
  currentUserId?: string;
  onAddAccount: React.MouseEventHandler<HTMLButtonElement>;
  addAccountButtonRef?: React.Ref<HTMLButtonElement>;
}

export function AccountFilters({
  ownerUserId,
  onOwnerChange,
  onRefresh,
  currentUserId,
  onAddAccount,
  addAccountButtonRef,
}: AccountFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 ml-auto max-md:ml-0">
      <div className="w-[200px]">
        <OwnerFilter
          value={ownerUserId}
          onChange={(val) => onOwnerChange(val as string | null)}
          currentUserId={currentUserId}
          allLabel="All Accounts"
          mineLabel="My Accounts"
          ariaLabel="Filter accounts by owner"
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
        <Button
          type="button"
          size="sm"
          aria-label="Add a new account"
          onClick={onAddAccount}
          ref={addAccountButtonRef}
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Add account
        </Button>
    </div>
  );
}
