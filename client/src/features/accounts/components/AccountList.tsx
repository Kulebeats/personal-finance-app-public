import { Landmark, Plus } from "lucide-react";
import { Account } from "@/lib/api";
import { AccountGroup } from "./AccountGroup";
import { AccountCard } from "./AccountCard";
import { ASSET_GROUPS, LIABILITY_GROUPS } from "../constants";
import { EmptyState } from "@/components/ui/empty-state";
import { isCurrencyCode } from "@shared/denomination";

interface AccountListProps {
  groupedAccounts: Record<string, Account[]>;
  accounts?: Account[];
  getGroupTotal: (accounts: Account[]) => number;
  isFiltered?: boolean;
  hasAccessibleAccounts?: boolean;
  onResetFilter?: () => void;
  onAddAccount: React.MouseEventHandler<HTMLButtonElement>;
}

export function AccountList({
  groupedAccounts,
  accounts,
  getGroupTotal,
  isFiltered = false,
  hasAccessibleAccounts,
  onResetFilter,
  onAddAccount,
}: AccountListProps) {
  // Check if any accounts exist to handle empty state
  const hasAccounts = accounts && accounts.length > 0;
  const nativeTotals = (rows: Account[]) => Array.from(new Set(rows.map(row => row.currency).filter(isCurrencyCode)))
    .map(currency => ({ currency, amount: getGroupTotal(rows.filter(row => row.currency === currency)) }));

  if (!hasAccounts) {
    if (isFiltered && hasAccessibleAccounts !== false) return <EmptyState icon={Landmark} title="No accounts match this filter" description="Choose All accounts to see your accessible accounts." primaryAction={{ label: "Show All Accounts", onClick: () => onResetFilter?.() }} testId="accounts-filtered-empty-state" />;
    return (
      <>
        <EmptyState
          icon={Landmark}
          title="No accounts yet"
          description="Add your first account to start tracking your finances."
          primaryAction={{
            label: "Add Account",
            icon: Plus,
            onClick: onAddAccount,
          }}
          testId="accounts-empty-state"
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
              totals={nativeTotals(groupAccounts)}
              denominationUnavailable={groupAccounts.some(account => !isCurrencyCode(account.currency))}
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
              totals={nativeTotals(groupAccounts)}
              denominationUnavailable={groupAccounts.some(account => !isCurrencyCode(account.currency))}
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
