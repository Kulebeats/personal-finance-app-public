import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { accounts, userDisplaySettings, users } from "@shared/schema";
import { z } from "zod";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ConflictError, NotFoundError, ValidationError } from "../../core/errors";
import { Money, toMoneyDto } from "../../core/money";
import { db } from "../../db";
import { lockTransactionCreateGrant } from "../../repositories/TransactionCreateBoundary";
import { goalAccountAssignmentService } from "../GoalAccountAssignmentService";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";
import { findReconciliationReplay, postReconciliation } from "./account-reconciliation-posting";

const fields = {
  targetBalance: z.object({
    amount: z.string().regex(/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }).strict(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)), "Invalid account version"),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().uuid().transform(key => key.toLowerCase()),
};
export const reconciliationSchema = z.discriminatedUnion("mode", [
  z.object({ ...fields, mode: z.literal("preview") }).strict(),
  z.object({ ...fields, mode: z.literal("apply"), previewToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);

type Reconciliation = z.infer<typeof reconciliationSchema>;

export async function reconcileAccount(accountId: string, householdId: string, userId: string, input: Reconciliation) {
  const target = new Money(input.targetBalance.amount, input.targetBalance.currency);
  const version = new Date(input.expectedUpdatedAt).toISOString();
  const request = JSON.stringify(["account-reconciliation-v1", householdId, userId, accountId, input.idempotencyKey,
    version, target.toString(), input.targetBalance.currency, input.reason]);

  const result = await db.transaction(async tx => {
    const actor = await lockTransactionCreateGrant(tx, householdId, { createActor: { householdId, userId } });
    if (!actor) throw new NotFoundError("Account");
    const [row] = await tx.select({ account: accounts, rowVersion: sql<string>`xmin::text` }).from(accounts)
      .where(and(eq(accounts.id, accountId), visibleAccountPredicate(actor)))
      .for(input.mode === "preview" ? "share" : "update");
    if (!row) throw new NotFoundError("Account");
    const { account } = row;

    const digest = createHash("sha256").update(JSON.stringify([request, input.mode === "apply" ? input.previewToken : null])).digest("hex");
    if (input.mode === "apply") {
      const replay = await findReconciliationReplay(tx, account, actor, input.idempotencyKey, digest);
      if (replay) return replay;
    }
    if (account.isArchived) throw new ConflictError("Archived accounts cannot be reconciled");
    if (account.updatedAt?.toISOString() !== version) throw new ConflictError("Account changed. Preview the correction again.");
    if (input.targetBalance.currency !== account.currency) throw new ValidationError("Use the account currency");

    if (!account.isAsset && target.lt(0)) {
      throw new ValidationError("Reconciliation supports a zero or positive amount owed. A liability credit balance is unsupported.");
    }
    const current = new Money(account.balance, account.currency);
    const delta = target.subtract(current);
    if (delta.abs().gt("9999999999999.99")) throw new ValidationError("Adjustment exceeds the ledger amount limit");
    if (account.isAsset && delta.lt(0) && target.lt(0)) throw new ValidationError("Adjustment exceeds the available account balance");
    // Use the stored display timezone, then the profile timezone, as other dated postings do.
    const [clock] = await tx.select({ postingDate: sql<string>`to_char(transaction_timestamp() AT TIME ZONE
      coalesce(nullif(${userDisplaySettings.timezone}, ''), nullif(${users.timezone}, ''), 'UTC'), 'YYYY-MM-DD')` })
      .from(users).leftJoin(userDisplaySettings, eq(userDisplaySettings.userId, users.id)).where(eq(users.id, userId));
    const quote = {
      postingDate: clock.postingDate,
      currentBalance: toMoneyDto(current, account.currency),
      targetBalance: toMoneyDto(target, account.currency),
      adjustment: toMoneyDto(delta, account.currency),
    };
    // The row version also changes for distinct updates within one public timestamp millisecond.
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("Reconciliation preview signing is unavailable");
    const token = createHmac("sha256", secret).update(JSON.stringify([request, row.rowVersion, quote])).digest();
    if (input.mode === "preview") return { ...quote, previewToken: token.toString("hex") };
    if (!timingSafeEqual(token, Buffer.from(input.previewToken, "hex"))) {
      throw new ConflictError("Preview the current account and submit its unchanged correction");
    }
    if (delta.isZero()) throw new ValidationError("The recorded balance already matches the statement.");
    return postReconciliation(tx, account, actor, input.idempotencyKey, digest, input.reason, quote);
  });

  if (input.mode === "apply") {
    // Re-read the current account just as ordinary postings do. On a lost response,
    // the goal synchronizer skips unchanged progress rather than replaying the old delta.
    await Promise.all([
      goalAccountAssignmentService.syncGoalsForAccount(accountId, "transaction_created"),
      invalidateOnChangeAfterCommit("account", householdId),
      invalidateOnChangeAfterCommit("transaction", householdId),
    ]);
  }
  return result;
}
