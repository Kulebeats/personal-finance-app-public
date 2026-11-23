import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import type { Account } from "@shared/schema";
import { ConflictError, ValidationError } from "../utils/errorHandler";
import type { TransactionType } from "../utils/withTransaction";

export const isAssetAccountType = (type: Account["type"]) =>
  !["credit", "loan", "mortgage", "other_liability"].includes(type);

export function includesAccountBasis(data: Partial<Account>): boolean {
  return data.currency !== undefined || data.type !== undefined || data.initialBalance !== undefined || data.isAsset !== undefined;
}

/** The caller holds the account row lock before this independent activity read. */
export async function prepareAccountBasisUpdate(tx: TransactionType, account: Account, data: Partial<Account>): Promise<Partial<Account>> {
  const openingChanged = data.initialBalance !== undefined && !new Decimal(account.initialBalance).eq(data.initialBalance);
  const typeChanged = data.type !== undefined && data.type !== account.type;
  const classificationChanged = typeChanged || (data.isAsset !== undefined && data.isAsset !== account.isAsset);
  const currencyChanged = data.currency !== undefined && data.currency !== account.currency;
  if (!openingChanged && !classificationChanged && !currencyChanged) return data;

  // These amounts are stored in the account's denomination and may exist
  // before the first ledger entry. Inspect the locked row before applying any replacements.
  if ((classificationChanged || currencyChanged)
    && (account.estimatedValue != null || account.creditLimit != null || account.availableBalance != null)) {
    throw new ConflictError("Stored account amounts prevent changes to currency or account classification");
  }

  const id = account.id;
  const history = await tx.execute<{ active: boolean }>(sql`SELECT
    EXISTS (SELECT 1 FROM transactions WHERE account_id=${id} OR transfer_account_id=${id})
    OR EXISTS (SELECT 1 FROM account_balance_snapshots WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM account_worth_captures WHERE household_id=${account.householdId}
      AND evidence->'accounts' @> jsonb_build_array(jsonb_build_object('accountId', ${id}::text)))
    OR EXISTS (SELECT 1 FROM investment_transactions WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM holdings WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM grz_bonds WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM grz_tbills WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM pension_holdings WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM currency_accounts WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM goal_account_assignments WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM goals WHERE debt_account_id=${id} OR linked_account_id=${id})
    OR EXISTS (SELECT 1 FROM recurring_transactions WHERE account_id=${id})
    OR EXISTS (SELECT 1 FROM recurring_investments WHERE account_id=${id})
    AS active`);
  if (history.rows[0].active || !new Decimal(account.balance).eq(account.initialBalance)) {
    throw new ConflictError("Account activity prevents changes to currency, account type or opening balance");
  }
  const isAsset = isAssetAccountType(data.type ?? account.type);
  if (data.isAsset !== undefined && data.isAsset !== isAsset) throw new ValidationError("Account classification must match its type");
  return { ...data, ...(typeChanged ? { isAsset } : {}), ...(openingChanged ? { balance: data.initialBalance } : {}) };
}
