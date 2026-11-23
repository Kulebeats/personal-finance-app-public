/**
 * A contribution paid from an account: one expense and its contribution link
 * to the goal, committed together or not at all (#245 review, Astra round 2).
 *
 * The client used to create the expense, then link it. A refused link (most
 * often the over-fund 409, which the client cannot predict across currencies)
 * left the expense committed, and a retry recorded a second one. Here the link's
 * own checks (visibility, currency conversion, the over-fund rule under the goal
 * lock) run in the expense's transaction, so a refusal commits nothing and the
 * client simply sends the same request again.
 *
 * Lock order is the transaction writers': the account (balance) and the new
 * transaction row first, then the goal, as an edit of a linked source takes them.
 *
 * A retry is recognised by immutable evidence, not by the link (which a member
 * can remove): the expense holding the key (`transactions.idempotency_key` is
 * unique) and its trigger-sealed create intent, whose digest binds the household,
 * the member, the key, the expense and the goal named at creation (#245, Astra round 3).
 */
import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { goals, transactionCreateOwnerIntents, transactions } from "@shared/schema";
import { Money } from "../../core/money";
import { accountRepository } from "../../repositories/AccountRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { getPostgresError } from "../../utils/postgresError";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { invalidateOnChangeAfterCommit } from "../CacheInvalidation";
import { syncGoalsForAccount } from "./assignment.sync";
import { transactionGoalLinkService } from "../TransactionGoalLinkService";
import type { HouseholdContext } from "../../middleware/householdGuard";

export interface AccountContributionInput {
  accountId: string;
  /** In the account's own currency. */
  amount: { amount: string; currency: string };
  date: string;
  reason?: string;
  /** Count the expense in the budget under this category; otherwise it is excluded. */
  categoryId?: string;
  confirmOverfund: boolean;
  /** One per contribution the member submits; a repeat returns the first result. */
  idempotencyKey: string;
}

export interface AccountContributionResult {
  transactionId: string;
  replayed: boolean;
}

const KEY_REUSED = "This request key was already used for a different contribution";

/** The expense's name and notes, as the contribution modal has always written them. */
function contributionText(goal: { id: string; name: string }, reason?: string) {
  const marker = `Goal contribution: ${goal.name} [goal:${goal.id}]`;
  return { name: marker, notes: reason ? `${reason} | ${marker}` : marker };
}

/**
 * The sealed identity of one contribution: who made it, with which key, as which
 * expense, to which goal, from which account, for what amount on what date, in
 * which budget category and with what reason. A key resent with any of these
 * changed is a different request, and conflicts.
 */
function contributionDigest(
  viewer: HouseholdContext, input: AccountContributionInput, transactionId: string, goalId: string,
): string {
  const amount = new Money(input.amount.amount, input.amount.currency);
  const fields = ["goal-account-contribution-v1", viewer.householdId, viewer.userId, input.idempotencyKey,
    transactionId, goalId, input.accountId, amount.toString(), input.amount.currency, input.date,
    input.categoryId ?? null, input.reason || null];
  return "v1:" + createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/**
 * A key already used, read in the caller's transaction: the same member's
 * contribution to this goal replays its receipt, even if the link was removed
 * since; any other use of the key conflicts.
 */
async function findReplay(
  tx: TransactionType, goalId: string, viewer: HouseholdContext, input: AccountContributionInput,
): Promise<AccountContributionResult | undefined> {
  const key = input.idempotencyKey;
  const [existing] = await tx.select({ id: transactions.id }).from(transactions)
    .where(eq(transactions.idempotencyKey, key)).limit(1);
  if (!existing) return undefined;
  const [intent] = await tx.select({ requestDigest: transactionCreateOwnerIntents.requestDigest })
    .from(transactionCreateOwnerIntents).where(and(
      eq(transactionCreateOwnerIntents.transactionId, existing.id),
      eq(transactionCreateOwnerIntents.idempotencyKey, key),
      eq(transactionCreateOwnerIntents.householdId, viewer.householdId),
      eq(transactionCreateOwnerIntents.actorUserId, viewer.userId),
      eq(transactionCreateOwnerIntents.operation, "ordinary"),
      eq(transactionCreateOwnerIntents.postingConfirmed, true),
    )).limit(1);
  if (intent?.requestDigest !== contributionDigest(viewer, input, existing.id, goalId)) {
    throw new ConflictError(KEY_REUSED);
  }
  return { transactionId: existing.id, replayed: true };
}

interface RecordedContribution {
  result: AccountContributionResult;
  /** Set when this call wrote the expense, for the after-commit work. */
  accountId?: string;
}

async function recordContribution(
  tx: TransactionType, goalId: string, viewer: HouseholdContext, input: AccountContributionInput, ipAddress?: string,
): Promise<RecordedContribution> {
  const replay = await findReplay(tx, goalId, viewer, input);
  if (replay) return { result: replay };
  const { householdId, userId } = viewer;
  const [goal] = await tx.select({ id: goals.id, name: goals.name }).from(goals)
    .where(and(eq(goals.id, goalId), eq(goals.householdId, householdId))).limit(1);
  if (!goal) throw new NotFoundError("Goal not found");
  const account = await accountRepository.findByIdWithVisibility(input.accountId, householdId, userId);
  if (!account) throw new NotFoundError("Account not found");
  if (input.amount.currency !== account.currency) {
    throw new ValidationError("Contribution currency must match the account currency", [
      { field: "amount.currency", message: `This account is in ${account.currency}` },
    ]);
  }
  const amount = new Money(input.amount.amount, account.currency);
  const audit = { householdId, userId, ipAddress };
  const id = randomUUID();

  const { transaction } = await transactionRepository.createWithinTransaction(tx, {
    id,
    householdId,
    ownerUserId: userId,
    accountId: account.id,
    ...contributionText(goal, input.reason),
    amount: amount.toString(),
    currency: account.currency,
    date: input.date,
    type: "expense",
    categoryId: input.categoryId ?? null,
    isExcludedFromBudget: input.categoryId === undefined,
    idempotencyKey: input.idempotencyKey,
  }, {
    createActor: { householdId, userId },
    validateReferences: true,
    publishCreatedEvent: true,
    originalOwnerIntent: {
      actorUserId: userId, requestDigest: contributionDigest(viewer, input, id, goalId),
    },
    audit: { ...audit, metadata: { operation: "goalContributionFromAccount", goalId } },
  });
  // The posting takes the currency of the account as locked; it must still be the
  // one this amount was checked against before the lock, or nothing is written.
  if (transaction.currency !== account.currency) {
    throw new ValidationError("Contribution currency must match the account currency", [
      { field: "amount.currency", message: `This account is in ${transaction.currency}` },
    ]);
  }
  // The link's checks run here, after the goal lock; a refusal rolls the expense back.
  await transactionGoalLinkService.linkTransaction(goalId, householdId, userId, {
    transactionId: transaction.id,
    linkType: "contribution",
    amount: { amount: amount.toString(), currency: account.currency },
    confirmOverfund: input.confirmOverfund,
    viewer,
  }, tx, { userId, ipAddress });
  return { result: { transactionId: transaction.id, replayed: false }, accountId: transaction.accountId };
}

export async function contributeFromAccount(
  goalId: string, viewer: HouseholdContext, input: AccountContributionInput, ipAddress?: string,
): Promise<AccountContributionResult> {
  let recorded: RecordedContribution;
  try {
    recorded = await withTransaction((tx) => recordContribution(tx, goalId, viewer, input, ipAddress));
  } catch (error) {
    // A concurrent submit with the same key won the unique index: return its result.
    if (getPostgresError(error)?.code !== "23505") throw error;
    const winner = await withTransaction((tx) => findReplay(tx, goalId, viewer, input));
    if (!winner) throw error;
    return winner;
  }

  const { result, accountId } = recorded;
  if (!accountId) return result;
  await invalidateOnChangeAfterCommit("transaction", viewer.householdId);
  try {
    await syncGoalsForAccount(accountId, "transaction_created");
  } catch (error) {
    logger.error("Goal auto-sync failed after a goal contribution from an account", { accountId, error });
  }
  return result;
}
