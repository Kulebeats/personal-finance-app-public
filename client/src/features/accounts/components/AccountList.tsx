import { useState } from "react";
import { Landmark, Plus } from "lucide-react";
import { Account } from "@/lib/api";
import { AccountGroup } from "./AccountGroup";
import { AccountCard } from "./AccountCard";
import { ASSET_GROUPS, LIABILITY_GROUPS } from "../constants";
import { AddAccountModal } from "./AddAccountModal";
import { EmptyState } from "@/components/ui/empty-state";

interface AccountListProps {
  groupedAccounts: Record<string, Account[]>;
  accounts?: Account[];
  getGroupTotal: (accounts: Account[]) => number;
}

export function AccountList({
  groupedAccounts,
  accounts,
  getGroupTotal,
}: AccountListProps) {
  // State for AddAccountModal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Check if any accounts exist to handle empty state
  const hasAccounts = accounts && accounts.length > 0;

  if (!hasAccounts) {
    return (
      <>
        <EmptyState
          icon={Landmark}
          title="No accounts yet"
          description="Add your first account to start tracking your finances."
          primaryAction={{
            label: "Add Account",
            icon: Plus,
            onClick: () => setIsAddModalOpen(true),
          }}
          testId="accounts-empty-state"
        />
        <AddAccountModal
          open={isAddModalOpen}
          onOpenChange={setIsAddModalOpen}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* Asset Groups */}
      {ASSET_GROUPS.map((groupName) => {
        const groupAccounts = groupedAccounts[groupName];
        if (!groupAccounts || groupAccounts.length === 0) return null;

        return (
          <div key={groupName}>
            <AccountGroup
              title={groupName}
              amount={getGroupTotal(groupAccounts)}
            />
            <div className="mt-2">
              {groupAccounts.map((account) => (
                <AccountCard key={account.id} account={account} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Liability Groups */}
      {LIABILITY_GROUPS.map((groupName) => {
        const groupAccounts = groupedAccounts[groupName];
        if (!groupAccounts || groupAccounts.length === 0) return null;

        return (
          <div key={groupName}>
            <AccountGroup
              title={groupName}
              amount={getGroupTotal(groupAccounts)}
              isLiability
            />
            <div className="mt-2">
              {groupAccounts.map((account) => (
                <AccountCard key={account.id} account={account} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
