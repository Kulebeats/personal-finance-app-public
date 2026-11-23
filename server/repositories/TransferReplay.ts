import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, transactions, transactionCreateOwnerIntents, type Transaction } from "@shared/schema";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { Money } from "../core/money";
import { db } from "../db";
import type { HouseholdContext } from "../middleware/householdGuard";
import { transferHash } from "../services/TransferCreateRequest";
import { getVisibleRecurringRuleById } from "../services/recurring/RecurringAudienceQuery";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errorHandler";
import type { TransactionType } from "../utils/withTransaction";
import { lockTransactionCreateGrant } from "./TransactionCreateBoundary";
import { readPostingEffect } from "./TransactionPostingEffect";

export function requireTransferPair(legs: Transaction[]) {
  const outflow = legs.find(leg => leg.isTransferIn === false);
  const inflow = legs.find(leg => leg.isTransferIn === true);
  if (legs.length !== 2 || !outflow || !inflow || outflow.type !== "transfer" || inflow.type !== "transfer" ||
      outflow.accountId === inflow.accountId || outflow.transferAccountId !== inflow.accountId ||
      inflow.transferAccountId !== outflow.accountId || !outflow.transferTransactionId ||
      (outflow.currency === inflow.currency && !new Money(outflow.amount).equals(new Money(inflow.amount))) ||
      outflow.transferTransactionId !== inflow.transferTransactionId || outflow.householdId !== inflow.householdId) {
    throw new ValidationError("Transfer legs require reconciliation", [{ field: "transfer", message: "Expected a complete reciprocal pair" }]);
  }
  return { outflow, inflow };
}

export function requireTransferVisibility(rows: { isPrivate: boolean | null; ownerUserId: string | null }[], userId: string) {
  if (rows.some(row => row.isPrivate !== false && row.ownerUserId !== userId)) throw new NotFoundError("Transfer not found");
}

interface LegacyTransferTerms {
  fromAccountId: string;
  toAccountId: string;
  amount: number | string;
  inflowAmount?: string;
  currency?: string;
  destinationCurrency?: string;
}

export async function visibleTransferLegs(tx: TransactionType, actor: HouseholdContext, pairId: string) {
  const rows = await tx.select({ leg: transactions, account: accounts, intent: transactionCreateOwnerIntents,
    edited: sql<boolean>`${transactions.updatedAt} IS DISTINCT FROM ${transactions.createdAt} OR EXISTS
      (SELECT 1 FROM audit_logs a WHERE a.household_id = ${transactions.householdId}
        AND a.entity_id = ${transactions.id} AND a.entity_type = 'transaction' AND a.action = 'UPDATE')`,
  }).from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(transactionCreateOwnerIntents, eq(transactionCreateOwnerIntents.transactionId, transactions.id))
    .where(and(eq(transactions.transferTransactionId, pairId), visibleTransactionPredicate(actor)));
  if (rows.length !== 2) throw new NotFoundError("Transfer not found");
  return rows;
}

export async function readTransferReplay(tx: TransactionType, actor: HouseholdContext, key: string, terms: string, legacy?: LegacyTransferTerms) {
  const [existing] = await tx.select().from(transactions).where(and(
    eq(transactions.householdId, actor.householdId), eq(transactions.idempotencyKey, key),
  ));
  if (!existing) return;
  if (existing.type !== "transfer" || !existing.transferTransactionId) {
    const [visible] = await tx.select({ recurringId: transactions.recurringTransactionId }).from(transactions)
      .where(and(eq(transactions.id, existing.id), visibleTransactionPredicate(actor)));
    if (!visible) throw new NotFoundError("Transfer not found");
    if (visible.recurringId) {
      try { await getVisibleRecurringRuleById(visible.recurringId, actor, tx); }
      catch (error) {
        if (error instanceof NotFoundError) throw new NotFoundError("Transfer not found");
        throw error;
      }
    }
    throw new ConflictError("Transfer key already in use");
  }
  const rows = await visibleTransferLegs(tx, actor, existing.transferTransactionId);
  const { outflow, inflow } = requireTransferPair(rows.map(row => row.leg));
  const conflict = () => new ConflictError("Transfer key already in use");
  if (outflow.id !== existing.id) throw conflict();
  const intent = rows.find(row => row.leg.id === outflow.id)?.intent;
  if (intent) {
    const digest = "t1:" + transferHash([terms, outflow.id, inflow.id, outflow.transferTransactionId]);
    if (intent.operation !== "transfer" || intent.actorUserId !== actor.userId || intent.requestDigest !== digest ||
        intent.transferGroupId !== outflow.transferTransactionId || intent.transferInflowId !== inflow.id) throw conflict();
  } else {
    if (rows.some(row => row.edited)) throw conflict();
    if (!legacy) return;
    if (outflow.ownerUserId !== actor.userId || outflow.accountId !== legacy.fromAccountId ||
      outflow.transferAccountId !== legacy.toAccountId || !new Money(outflow.amount).equals(new Money(legacy.amount)) ||
      (legacy.currency && legacy.currency !== outflow.currency) ||
      (legacy.destinationCurrency && legacy.destinationCurrency !== inflow.currency)) throw conflict();
    // The source terms can already conflict before the destination quote exists.
    if (legacy.inflowAmount === undefined) return;
    if (!new Money(inflow.amount).equals(new Money(legacy.inflowAmount))) throw conflict();
  }
  for (const row of rows) readPostingEffect(row.account, row.leg);
  return { outflow, inflow, isDuplicate: true };
}

export async function authorizedTransferReplay(householdId: string, userId: string, key: string, terms: string, legacy?: LegacyTransferTerms) {
  return db.transaction(async tx => {
    const actor = await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
    if (!actor) throw new NotFoundError("Transfer not found");
    return readTransferReplay(tx, actor, key, terms, legacy);
  }, { isolationLevel: "repeatable read" });
}

export async function transferQuoteAccounts(householdId: string, userId: string, fromId: string, toId: string) {
  return db.transaction(async tx => {
    const actor = await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
    if (!actor) throw new NotFoundError("Transfer not found");
    const rows = await tx.select({ id: accounts.id, currency: accounts.currency }).from(accounts)
      .where(and(inArray(accounts.id, [fromId, toId]), visibleAccountPredicate(actor))).orderBy(accounts.id).for("share");
    return { from: rows.find(row => row.id === fromId), to: rows.find(row => row.id === toId) };
  });
}
