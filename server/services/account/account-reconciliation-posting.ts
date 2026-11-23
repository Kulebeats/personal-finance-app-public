import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { auditLogs, transactionCreateOwnerIntents, transactions, type Account } from "@shared/schema";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { ConflictError, NotFoundError } from "../../core/errors";
import { Money } from "../../core/money";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { isPostgresError } from "../../utils/postgresError";
import type { TransactionType } from "../../utils/withTransaction";

const money = z.object({ amount: z.string(), currency: z.string() });
const quoteSchema = z.object({
  currentBalance: money, targetBalance: money, adjustment: money, postingDate: z.string(),
});
type Quote = z.infer<typeof quoteSchema>;
const conflict = () => new ConflictError("Idempotency key does not identify this reconciliation");

// The immutable create intent binds the original quote to the actor, request and posting.
// Serialize scalar fields explicitly: PostgreSQL jsonb can reorder object properties.
function seal(account: Account, userId: string, key: string, requestDigest: string, id: string, quote: Quote) {
  const fields = ["account-reconciliation-receipt-v1", account.householdId, account.id, userId, key, requestDigest, id,
    quote.postingDate, quote.currentBalance.amount, quote.currentBalance.currency, quote.targetBalance.amount,
    quote.targetBalance.currency, quote.adjustment.amount, quote.adjustment.currency];
  return "v1:" + createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export async function findReconciliationReplay(tx: TransactionType, account: Account, actor: HouseholdContext, key: string, digest: string) {
  const { userId } = actor;
  const [existing] = await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.idempotencyKey, key));
  if (!existing) return;
  const [visible] = await tx.select({ id: transactions.id }).from(transactions).where(and(
    eq(transactions.id, existing.id), visibleTransactionPredicate(actor),
  ));
  if (!visible) throw new NotFoundError("Transaction");
  const [intent] = await tx.select().from(transactionCreateOwnerIntents).where(and(
    eq(transactionCreateOwnerIntents.transactionId, existing.id), eq(transactionCreateOwnerIntents.idempotencyKey, key),
    eq(transactionCreateOwnerIntents.householdId, account.householdId), eq(transactionCreateOwnerIntents.actorUserId, userId),
    eq(transactionCreateOwnerIntents.operation, "ordinary"), eq(transactionCreateOwnerIntents.postingConfirmed, true),
  ));
  if (!intent) throw conflict();
  const evidence = await tx.select({ details: auditLogs.details }).from(auditLogs).where(and(
    eq(auditLogs.entityId, existing.id), eq(auditLogs.entityType, "transaction"), eq(auditLogs.action, "CREATE"),
    // The CREATE audience is fixed at posting time; the account can change privacy later.
    eq(auditLogs.userId, userId), or(isNull(auditLogs.householdId), eq(auditLogs.householdId, account.householdId)),
  )).limit(2);
  const receipt = z.object({ reconciliation: quoteSchema }).safeParse(evidence[0]?.details);
  if (evidence.length !== 1 || !receipt.success) throw conflict();
  const quote = receipt.data.reconciliation;
  if (seal(account, userId, key, digest, existing.id, quote) !== intent.requestDigest) throw conflict();
  return { ...quote, transactionId: existing.id };
}

export async function postReconciliation(tx: TransactionType, account: Account, actor: HouseholdContext, key: string,
  digest: string, reason: string, quote: Quote) {
  const { userId } = actor;
  const id = randomUUID();
  const delta = new Money(quote.adjustment.amount, account.currency);
  try {
    await tx.transaction(savepoint => transactionRepository.createWithinTransaction(savepoint, {
      id, householdId: account.householdId, accountId: account.id, ownerUserId: userId, isPrivate: account.isPrivate,
      type: "balance_adjustment", date: quote.postingDate, name: "Account reconciliation", notes: reason,
      currency: account.currency, amount: delta.abs().toString(), isBalanceAdjustmentIncrease: delta.gt(0),
      source: "manual", idempotencyKey: key,
    }, {
      createActor: { householdId: account.householdId, userId }, publishCreatedEvent: true,
      originalOwnerIntent: { actorUserId: userId, requestDigest: seal(account, userId, key, digest, id, quote) },
      audit: { householdId: account.isPrivate ? null : account.householdId, userId, metadata: { reconciliation: quote, reason } },
    }));
  } catch (error) {
    // Same-account retries serialize on the account lock. A competing account or
    // producer can win the global key between lookup and insert. Resolve its visibility
    // after the failed posting and all of its provisional writes have rolled back.
    if (isPostgresError(error, "23505", "idempotency_key")) {
      const replay = await findReconciliationReplay(tx, account, actor, key, digest);
      if (replay) return replay;
      throw conflict();
    }
    throw error;
  }
  return { ...quote, transactionId: id };
}
