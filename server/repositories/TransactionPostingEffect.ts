import Decimal from "decimal.js";
import { and, eq, inArray, sql } from "drizzle-orm";
import { auditLogs, transactions, type Account } from "@shared/schema";
import { Money } from "../core/money";
import { ValidationError } from "../utils/errorHandler";
import type { TransactionType } from "../utils/withTransaction";

export type PostingMode = "posted" | "history_only";
export type PostingAccount = Pick<Account, "id" | "householdId" | "currency" | "isAsset">;
export interface PostingInput {
  source?: string | null;
  type: string;
  amount: string;
  currency?: string | null;
  isTransferIn?: boolean | null;
  isBalanceAdjustmentIncrease?: boolean | null;
}
export interface PostingReceipt {
  currency: string;
  postedBalanceDelta: string;
  postingMode: PostingMode;
  postedAccountIsAsset: boolean;
}
export interface RecordedPostingInput extends PostingInput {
  id: string;
  accountId: string;
  householdId: string;
  date: string;
  isPending?: boolean | null;
  status?: string | null;
  transferTransactionId?: string | null;
  transferAccountId?: string | null;
  postedBalanceDelta?: string | null;
  postingMode?: string | null;
  postedAccountIsAsset?: boolean | null;
}
export interface PostingEffectReadOptions { allowLegacyOrdinaryAsset?: boolean }
export interface PostingEffect { delta: Money; mode: PostingMode }

function refuse(message: string): never {
  throw new ValidationError(message, [{ field: "posting", message }]);
}
function magnitude(value: string, allowZero: boolean): string {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) refuse("Posting amount requires an unsigned decimal string with at most two fractional digits");
  const amount = new Decimal(value);
  if ((!allowZero && amount.isZero()) || amount.gt("9999999999999.99")) refuse("Posting amount is outside the supported range");
  return value;
}
function denomination(account: PostingAccount, input: PostingInput): string {
  if (typeof account.currency !== "string" || !/^[A-Z]{3}$/.test(account.currency)) refuse("Account denomination requires reconciliation");
  if (input.currency !== undefined && input.currency !== null && input.currency !== account.currency) refuse("Transaction currency must match the locked account currency");
  return account.currency;
}

/** Amounts are positive; direction and the locked economic class determine effect. */
export function calculateSignedAccountEffect(account: PostingAccount, input: PostingInput): Money {
  const currency = denomination(account, input);
  const amount = new Money(magnitude(input.amount, input.type === "balance_adjustment"), currency);
  let delta: Money;
  switch (input.type) {
    case "income":
    case "asset_settlement": delta = amount; break;
    case "expense": delta = amount.negated(); break;
    case "transfer":
      if (typeof input.isTransferIn !== "boolean") refuse("Transfer direction must be explicit");
      delta = input.isTransferIn ? amount : amount.negated();
      break;
    case "balance_adjustment":
      // Increase/decrease denotes the numeric balance, including positive debt.
      return input.isBalanceAdjustmentIncrease === false ? amount.negated() : amount;
    default: return refuse("Unknown transaction posting type");
  }
  return account.isAsset ? delta : delta.negated();
}

export function buildPostingReceipt(account: PostingAccount, input: PostingInput, mode: PostingMode = "posted"): PostingReceipt {
  if (mode !== "posted" && mode !== "history_only") refuse("Unknown transaction posting mode");
  if (mode === "history_only" && (input.source !== "csv_import" || (input.type !== "expense" && input.type !== "income"))) refuse("History-only mode requires an ordinary import row");
  const delta = calculateSignedAccountEffect(account, input);
  return { currency: account.currency, postedBalanceDelta: mode === "history_only" ? "0.00" : delta.toString(),
    postingMode: mode, postedAccountIsAsset: account.isAsset };
}

/** Strict receipt verification; absence cannot be justified by source/class alone. */
export function readPostingEffect(account: PostingAccount, row: RecordedPostingInput): PostingEffect {
  if (row.accountId !== account.id || row.householdId !== account.householdId || !row.currency || row.currency !== account.currency) refuse("Posting account or source denomination requires reconciliation");
  if (row.postedBalanceDelta === null || row.postedBalanceDelta === undefined || row.postingMode === null || row.postingMode === undefined ||
    row.postedAccountIsAsset === null || row.postedAccountIsAsset === undefined) refuse("Transaction has no complete posting receipt; reconciliation is required");
  if (row.postedAccountIsAsset !== account.isAsset) refuse("Posted economic class differs from the locked account");
  if (row.postingMode !== "posted" && row.postingMode !== "history_only") refuse("Unknown recorded posting mode");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(row.postedBalanceDelta)) refuse("Recorded posting effect is malformed");
  const expected = buildPostingReceipt(account, row, row.postingMode);
  const delta = new Money(row.postedBalanceDelta, account.currency);
  if (!delta.equals(new Money(expected.postedBalanceDelta, account.currency))) refuse("Recorded posting effect contradicts the transaction");
  return { delta, mode: row.postingMode };
}

/** Caller holds the parent and account locks. Only untouched atomic manual assets qualify. */
export async function resolvePostingEffect(tx: TransactionType, account: PostingAccount, row: RecordedPostingInput,
  options: PostingEffectReadOptions = {}): Promise<PostingEffect> {
  const receiptValues = [row.postedBalanceDelta, row.postingMode, row.postedAccountIsAsset];
  if (receiptValues.some(value => value !== null && value !== undefined) || options.allowLegacyOrdinaryAsset === false) return readPostingEffect(account, row);
  if (!account.isAsset || row.accountId !== account.id || row.householdId !== account.householdId || row.source !== "manual" ||
    !row.currency || row.currency !== account.currency || row.isPending || row.status === "pending" || row.transferTransactionId || row.transferAccountId || row.isTransferIn ||
    (row.type !== "income" && row.type !== "expense")) refuse("Historical posting effect is unproven; reconciliation is required");
  magnitude(row.amount, false);
  const original = { accountId: row.accountId, amount: row.amount, currency: row.currency,
    date: row.date, type: row.type, source: row.source };
  const evidence = await tx.select({ action: auditLogs.action,
    compatible: sql<boolean>`${auditLogs.action} = 'CREATE' AND ${auditLogs.householdId} = ${account.householdId}
      AND ${auditLogs.createdAt} = ${transactions.createdAt} AND ${transactions.updatedAt} = ${transactions.createdAt}
      AND ${auditLogs.details}->'newValue' = ${JSON.stringify(original)}::jsonb`,
  }).from(auditLogs).innerJoin(transactions, eq(auditLogs.entityId, transactions.id)).where(and(
    eq(auditLogs.entityType, "transaction"), eq(auditLogs.entityId, row.id),
    inArray(auditLogs.action, ["CREATE", "UPDATE", "DELETE", "RESTORE"]),
  ));
  if (evidence.length !== 1 || evidence[0].action !== "CREATE" || evidence[0].compatible !== true) refuse("Historical posting has no unique compatible atomic CREATE evidence");
  return { delta: calculateSignedAccountEffect(account, row), mode: "posted" };
}
