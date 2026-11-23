/**
 * Transfer-leg attribution (NEW-37, R18.2).
 *
 * Both legs of a transfer used to render identically in the list and detail
 * views ("Uncategorized", same amount), so a user could not tell which leg left
 * an account and which arrived. Each leg now names its direction and its
 * counterpart: "Transfer to Savings" on the outgoing leg, "Transfer from
 * Checking" on the incoming one.
 *
 * The counterpart's name comes only from the accounts this viewer can already
 * list. A counterpart that is not in that list (a member's private account) is
 * never named: the label falls back to "another account".
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAccounts } from "@/hooks/useAccounts";
import type { TransactionWithDetails } from "./types";

type AccountNames = ReadonlyMap<string, string>;

const EMPTY_NAMES: AccountNames = new Map();
const UNKNOWN_COUNTERPART = "another account";

const TransferAccountNamesContext = createContext<AccountNames>(EMPTY_NAMES);

type TransferLegFields = Pick<TransactionWithDetails, "type" | "isTransferIn" | "transferAccountId">;

/** Pure label for one transfer leg; `null` for anything that is not a transfer. */
export function transferLegLabel(transaction: TransferLegFields, accountNames: AccountNames): string | null {
  if (transaction.type !== "transfer") return null;
  const counterpart = (transaction.transferAccountId && accountNames.get(transaction.transferAccountId))
    || UNKNOWN_COUNTERPART;
  return transaction.isTransferIn ? `Transfer from ${counterpart}` : `Transfer to ${counterpart}`;
}

/** Label for one leg, using the account names the nearest provider supplies. */
export function useTransferLegLabel(transaction: TransferLegFields): string | null {
  return transferLegLabel(transaction, useContext(TransferAccountNamesContext));
}

/**
 * Supplies the viewer's visible account names (archived and hidden included).
 * The accounts read runs only while the list holds a transfer (`isEnabled`).
 */
export function TransferAccountNamesProvider({ children, isEnabled = true }: { children: ReactNode; isEnabled?: boolean }) {
  const { data: accounts } = useAccounts({ includeArchived: true, includeHidden: true }, isEnabled);
  const names = useMemo<AccountNames>(
    () => new Map((accounts ?? []).map((account) => [account.id, account.name])),
    [accounts],
  );
  return (
    <TransferAccountNamesContext.Provider value={names}>
      {children}
    </TransferAccountNamesContext.Provider>
  );
}
