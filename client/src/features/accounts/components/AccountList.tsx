import { Landmark, Plus } from "lucide-react";
import { Account } from "@/lib/api";
import { AccountGroup } from "./AccountGroup";
import { AccountCard } from "./AccountCard";
import { ASSET_GROUPS, LIABILITY_GROUPS } from "../constants";
import { EmptyState } from "@/components/ui/empty-state";
import { isCurrencyCode } from "@shared/denomination";

/** What a confirmed frame shows: account rows, or one of the two empty states. */
export type AccountListKind = "rows" | "filtered-empty" | "first-account";
export type AccountEmptyKind = Exclude<AccountListKind, "rows">;

export interface AccountListProps {
  groupedAccounts: Record<string, Account[]>;
  accounts?: Account[];
  getGroupTotal: (accounts: Account[]) => number;
  isFiltered?: boolean;
  hasAccessibleAccounts?: boolean;
  onResetFilter?: () => void;
  onAddAccount: React.MouseEventHandler<HTMLButtonElement>;
  /**
   * C3-30: while access is re-checked, keep the last confirmed empty state's
   * action mounted (so keyboard focus survives) but withhold its claim text.
   */
  pendingEmptyState?: AccountEmptyKind;
}

type KindInput = Pick<AccountListProps, "accounts" | "isFiltered" | "hasAccessibleAccounts">;
export function accountListKind({ accounts, isFiltered = false, hasAccessibleAccounts }: KindInput): AccountListKind {
  if (accounts && accounts.length > 0) return "rows";
  return isFiltered && hasAccessibleAccounts !== false ? "filtered-empty" : "first-account";
}

const WITHHELD_TITLE = "Account details hidden";
const WITHHELD_DESCRIPTION = "They are shown again once your current access is confirmed.";

export function AccountList({
  groupedAccounts,
  accounts,
  getGroupTotal,
  isFiltered = false,
  hasAccessibleAccounts,
  onResetFilter,
  onAddAccount,
  pendingEmptyState,
}: AccountListProps) {
  const kind = pendingEmptyState ?? accountListKind({ accounts, isFiltered, hasAccessibleAccounts });
  const withheld = pendingEmptyState !== undefined;
  const nativeTotals = (rows: Account[]) => Array.from(new Set(rows.map(row => row.currency).filter(isCurrencyCode)))
    .map(currency => ({ currency, amount: getGroupTotal(rows.filter(row => row.currency === currency)) }));

  if (kind !== "rows") {
    if (kind === "filtered-empty") return <EmptyState icon={Landmark} title={withheld ? WITHHELD_TITLE : "No accounts match this filter"} description={withheld ? WITHHELD_DESCRIPTION : "Choose All accounts to see your accessible accounts."} primaryAction={{ label: "Show All Accounts", onClick: () => onResetFilter?.() }} testId="accounts-filtered-empty-state" />;
    return (
      <>
        <EmptyState
          icon={Landmark}
          title={withheld ? WITHHELD_TITLE : "No accounts yet"}
          description={withheld ? WITHHELD_DESCRIPTION : "Add your first account to start tracking your finances."}
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
