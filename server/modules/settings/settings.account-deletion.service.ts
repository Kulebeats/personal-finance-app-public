/**
 * Settings Module - Account Deletion Service
 *
 * Implements DPA-compliant right-to-erasure for a user account. Runs inside a
 * single transaction so it either fully completes or fully rolls back. The user
 * row is always HARD ANONYMISED (PII + financial-profile fields scrubbed,
 * credentials rotated to random values) rather than deleted, so the erasure
 * audit record keeps a valid actor reference.
 *
 * The household's SHARED financial data is treated by membership (a household
 * can have several members, and that data is jointly owned):
 *
 * 1. Last member out: household-scoped financial rows are HARD DELETED in
 *    foreign-key-safe order (children before parents), along with the household
 *    row. Child tables without a household_id column are removed via a subquery
 *    on their parent's household_id, so no readable financial row survives even
 *    where DB-level cascades were never applied (the app uses imperative
 *    db:push, not versioned migrations, so cascades can't be relied upon).
 * 2. Other members remain: the shared data and household row are RETAINED
 *    (deleting them would destroy the co-members' records); only the erased
 *    user's membership is removed. If they were the sole owner, the most-senior
 *    remaining member is promoted so the household stays governable. Mirrors the
 *    "leave household" path, except erasure is a right and so is never blocked.
 *
 * A BusinessAuditService DELETE row is written THROUGH the same transaction so
 * the erasure is durably logged and not itself erased.
 *
 * @module modules/settings/account-deletion-service
 */

import { grzBondValuations } from "@shared/grz-bond-valuation-schema";
import { grzPrincipalSettlements } from "@shared/grz-principal-settlement-schema";
import { grzBondPrincipalBasis } from "@shared/grz-principal-basis-schema";
import { anonymiseUser } from "./settings.account-deletion.identity";
import { erasePersonalExports, pseudonymiseErasedIdentity, removeErasedExportFiles } from "./settings.account-deletion.traces";
import { lockSipErasureHouseholds, lockSipErasureIdentity } from "./settings.account-deletion.sip";
import { eraseActorAiTraces, scrubHouseholdAiAttempts } from "../ai/ai.erasure";
import { abortActorInFlight } from "../ai/ai.inflight";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../../services/BusinessAuditService";
import {
  collectHouseholdUploadPaths,
  collectUserUploadPaths,
  recordErasedFileFailures,
} from "./settings.account-deletion.files";
import { drainErasurePurgeItems, recordPurgeItems } from "./settings.account-deletion.purge";
import { lockUserMembership } from "../../repositories/householdMembershipLock";
import {
  assertNoHousehold, assertSingleHousehold, lockHouseholdMembers, pickSuccessor, type LockedMember,
} from "./settings.account-deletion.membership";
import {
  // household-scoped parents
  households,
  householdMembers,
  householdPreferences,
  householdInvitations,
  accounts,
  auditLogs,
  transactions,
  budgets,
  budgetPeriods,
  goals,
  goalContributions,
  goalActivityLog,
  goalTransfers,
  goalImageUploads,
  transactionGoalLinks,
  recurringTransactions,
  recurringTransactionLinks,
  recurringTransactionHistory,
  recurringInvestments,
  recurringExecutionLog,
  transactionAttachments,
  transactionTags,
  transactionSplits,
  transactionComments,
  accountBalanceSnapshots,
  currencyAccounts,
  netWorthSnapshots,
  categories,
  categoryGroups,
  merchants,
  merchantAliases,
  merchantLogoUploads,
  merchantMergeHistory,
  tags,
  rules,
  ruleExecutionLog,
  filterPresets,
  dataExports,
  pendingReceipts,
  receiptConversionRecords,
  notifications,
  outboxEvents,
  // investments
  holdings,
  investmentTransactions,
  priceAlerts,
  taxLots,
  taxLotDisposals,
  // GRZ / pensions
  grzBonds,
  grzBondPayments,
  grzTBills,
  pensionHoldings,
  pensionContributions,
  // user-scoped
} from "@shared/schema";

export interface AccountDeletionContext {
  userId: string;
  /** Null for a user with no household (A-20). */
  householdId: string | null;
  /** Email as the request read it, outside the transaction. Erasure does not use it: it takes the address from the locked users row. */
  userEmail: string;
  ipAddress?: string;
}

export interface AccountDeletionResult {
  /** Whether the parent household row was also removed (sole member). */
  householdDeleted: boolean;
}

/**
 * A household-scoped parent table exposes a uuid `id` and a uuid `householdId`
 * column. Used to build the subquery of parent ids for a household, so child
 * rows that hang off the parent but lack a direct household_id column can be
 * removed by parent reference.
 */
type HouseholdScopedTable = PgTable & {
  id: PgColumn;
  householdId: PgColumn;
};

function idsBy(
  tx: TransactionType,
  parent: HouseholdScopedTable,
  householdId: string,
) {
  return tx
    .select({ id: parent.id })
    .from(parent)
    .where(eq(parent.householdId, householdId));
}

/**
 * Remove every household-scoped financial row, children before parents.
 * Runs inside the caller's transaction. Child tables without a household_id
 * column are removed via a subquery on their parent's household_id, so no
 * readable financial row survives even where database-level cascades were never
 * applied (the app uses imperative db:push, not versioned migrations).
 */
async function deleteHouseholdFinancialData(
  tx: TransactionType,
  householdId: string,
): Promise<void> {
  const byHH = (parent: HouseholdScopedTable) =>
    idsBy(tx, parent, householdId);

  // Investment-disposal chain (all carry household_id).
  await tx
    .delete(taxLotDisposals)
    .where(eq(taxLotDisposals.householdId, householdId));
  await tx.delete(taxLots).where(eq(taxLots.householdId, householdId));
  await tx.delete(priceAlerts).where(eq(priceAlerts.householdId, householdId));

  // GRZ, pensions, recurring investments (children via parent subquery).
  await tx.delete(grzPrincipalSettlements).where(eq(grzPrincipalSettlements.householdId, householdId));
  await tx.delete(grzBondPrincipalBasis).where(eq(grzBondPrincipalBasis.householdId, householdId));
  await tx.delete(grzBondValuations).where(eq(grzBondValuations.householdId, householdId));
  await tx
    .delete(grzBondPayments)
    .where(inArray(grzBondPayments.bondId, byHH(grzBonds)));
  await tx.delete(grzBonds).where(eq(grzBonds.householdId, householdId));
  await tx.delete(grzTBills).where(eq(grzTBills.householdId, householdId));
  // Settled installments, principal receipts and matured T-bills reference investment postings.
  // Private system audits have no household/user FK. Remove only audits bound
  // to actual purchases being erased, before those purchase IDs disappear.
  await tx.delete(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"),
    inArray(auditLogs.entityId, byHH(investmentTransactions))));
  await tx.delete(investmentTransactions).where(eq(investmentTransactions.householdId, householdId));
  // A completed SIP proof makes its BUY immutable. Remove that purchase/proof
  // before deleting custody holdings, whose FK would otherwise SET NULL on
  // the still-proven purchase. Keep the GRZ reference chain ahead of both.
  await tx.delete(holdings).where(eq(holdings.householdId, householdId));
  await tx
    .delete(pensionContributions)
    .where(inArray(pensionContributions.pensionHoldingId, byHH(pensionHoldings)));
  await tx
    .delete(pensionHoldings)
    .where(eq(pensionHoldings.householdId, householdId));
  await tx
    .delete(recurringExecutionLog)
    .where(
      inArray(
        recurringExecutionLog.recurringInvestmentId,
        byHH(recurringInvestments),
      ),
    );
  await tx
    .delete(recurringInvestments)
    .where(eq(recurringInvestments.householdId, householdId));

  // Goal children, then goals.
  await tx
    .delete(goalContributions)
    .where(inArray(goalContributions.goalId, byHH(goals)));
  await tx
    .delete(goalActivityLog)
    .where(inArray(goalActivityLog.goalId, byHH(goals)));
  await tx
    .delete(transactionGoalLinks)
    .where(inArray(transactionGoalLinks.goalId, byHH(goals)));
  await tx
    .delete(goalTransfers)
    .where(eq(goalTransfers.householdId, householdId));
  await tx
    .delete(goalImageUploads)
    .where(eq(goalImageUploads.householdId, householdId));
  await tx.delete(goals).where(eq(goals.householdId, householdId));

  // Recurring transaction children, then rules.
  await tx
    .delete(recurringTransactionHistory)
    .where(
      inArray(
        recurringTransactionHistory.recurringTransactionId,
        byHH(recurringTransactions),
      ),
    );
  await tx
    .delete(recurringTransactionLinks)
    .where(
      inArray(
        recurringTransactionLinks.recurringTransactionId,
        byHH(recurringTransactions),
      ),
    );
  await tx
    .delete(recurringTransactions)
    .where(eq(recurringTransactions.householdId, householdId));

  // Budget periods, then budgets.
  await tx
    .delete(budgetPeriods)
    .where(inArray(budgetPeriods.budgetId, byHH(budgets)));
  await tx.delete(budgets).where(eq(budgets.householdId, householdId));

  // Last-member erasure removes conversion proof and receipt links before postings.
  await tx.execute(sql`SELECT set_config('app.erasing_household', ${householdId}, true)`);
  await tx.delete(receiptConversionRecords).where(eq(receiptConversionRecords.householdId, householdId));
  await tx
    .delete(pendingReceipts)
    .where(eq(pendingReceipts.householdId, householdId));
  await tx.execute(sql`SELECT set_config('app.erasing_household', '', true)`);

  // Transaction children, then transactions.
  await tx
    .delete(transactionAttachments)
    .where(inArray(transactionAttachments.transactionId, byHH(transactions)));
  await tx
    .delete(transactionTags)
    .where(inArray(transactionTags.transactionId, byHH(transactions)));
  await tx
    .delete(transactionSplits)
    .where(inArray(transactionSplits.transactionId, byHH(transactions)));
  await tx
    .delete(transactionComments)
    .where(inArray(transactionComments.transactionId, byHH(transactions)));
  await tx.delete(transactions).where(eq(transactions.householdId, householdId));

  // Account children, then accounts.
  await tx
    .delete(accountBalanceSnapshots)
    .where(inArray(accountBalanceSnapshots.accountId, byHH(accounts)));
  await tx
    .delete(currencyAccounts)
    .where(inArray(currencyAccounts.accountId, byHH(accounts)));
  await tx.delete(accounts).where(eq(accounts.householdId, householdId));

  // Rules, merchants, categorisation, misc household-scoped data.
  await tx
    .delete(ruleExecutionLog)
    .where(inArray(ruleExecutionLog.ruleId, byHH(rules)));
  await tx.delete(rules).where(eq(rules.householdId, householdId));

  await tx
    .delete(merchantAliases)
    .where(inArray(merchantAliases.merchantId, byHH(merchants)));
  await tx
    .delete(merchantLogoUploads)
    .where(inArray(merchantLogoUploads.merchantId, byHH(merchants)));
  await tx
    .delete(merchantMergeHistory)
    .where(inArray(merchantMergeHistory.targetMerchantId, byHH(merchants)));
  await tx
    .delete(merchantMergeHistory)
    .where(inArray(merchantMergeHistory.sourceMerchantId, byHH(merchants)));
  await tx.delete(merchants).where(eq(merchants.householdId, householdId));

  await tx.delete(categories).where(eq(categories.householdId, householdId));
  await tx
    .delete(categoryGroups)
    .where(eq(categoryGroups.householdId, householdId));

  await tx.delete(tags).where(eq(tags.householdId, householdId));
  await tx
    .delete(filterPresets)
    .where(eq(filterPresets.householdId, householdId));
  await tx
    .delete(netWorthSnapshots)
    .where(eq(netWorthSnapshots.householdId, householdId));
  await tx.delete(dataExports).where(eq(dataExports.householdId, householdId));
  await tx
    .delete(notifications)
    .where(eq(notifications.householdId, householdId));
  await tx.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
}

interface HouseholdOutcome {
  readonly householdDeleted: boolean;
  readonly ownerSuccessorUserId: string | null;
  /** Purge items recorded for the household's files (A-34). */
  readonly purgeIds: readonly string[];
}

/**
 * Remove the erased user's membership, SCOPED to the resolved household (Gap
 * 1: not every household this user_id appears in), then decide the household
 * row's fate from the locked member snapshot.
 */
async function settleHousehold(
  tx: TransactionType,
  userId: string,
  householdId: string,
  lockedMembers: readonly LockedMember[],
): Promise<HouseholdOutcome> {
  await tx
    .delete(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  const remainingMembers = lockedMembers.filter((m) => m.userId !== userId);

  if (remainingMembers.length === 0) {
    // Sole member / last one out: the shared data has no other owner, so the
    // household-scoped financial rows, the household row, and its
    // preferences/invitations are all hard-deleted. The upload paths those
    // rows reference are collected and recorded as durable purge items
    // BEFORE they're deleted below — this is the last point they're readable,
    // and the household delete cascades their storage_objects manifest rows.
    const purgeIds = await recordPurgeItems(tx, await collectHouseholdUploadPaths(tx, householdId));
    await deleteHouseholdFinancialData(tx, householdId);
    await tx.delete(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    await tx.delete(householdInvitations).where(eq(householdInvitations.householdId, householdId));
    await tx.delete(notifications).where(eq(notifications.householdId, householdId));
    // The household cascade deletes ai_requests and detaches their attempts;
    // scrub those attempts' provider ids while they can still be found.
    await scrubHouseholdAiAttempts(tx, householdId);
    await tx.delete(households).where(eq(households.id, householdId));
    return { householdDeleted: true, ownerSuccessorUserId: null, purgeIds };
  }
  if (remainingMembers.some((m) => m.role === "owner")) {
    return { householdDeleted: false, ownerSuccessorUserId: null, purgeIds: [] };
  }

  // Other members remain: the jointly-owned shared data is RETAINED. The
  // erased user was the only owner, so promote the most-senior remaining
  // member, else the household would be ungovernable (governance needs an
  // owner). userId is nullable at the type level, so only real ids inherit.
  const candidates: { userId: string; joinedAt: Date | null }[] = [];
  for (const m of remainingMembers) {
    if (m.userId !== null) candidates.push({ userId: m.userId, joinedAt: m.joinedAt });
  }
  const successor = pickSuccessor(candidates);
  if (!successor) return { householdDeleted: false, ownerSuccessorUserId: null, purgeIds: [] };
  await tx
    .update(householdMembers)
    .set({ role: "owner" })
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, successor.userId)));
  return { householdDeleted: false, ownerSuccessorUserId: successor.userId, purgeIds: [] };
}

/**
 * Execute the full account erasure for a user inside one transaction. The
 * household's shared financial data is hard-deleted only when this user is the
 * last member out; while other members remain it is retained and, if needed,
 * ownership succeeds to the most-senior remaining member. A user with no
 * household (A-20: newly registered, or a member who left) is erased the same
 * way minus the household steps. The household row is locked with all
 * historical SIP anchors in UUID order before member/identity locks.
 * Single-household membership (Gap 1) and the fresh operational scope are
 * checked before any destructive write. Writes a durable erasure audit row.
 */
export async function eraseAccount(
  ctx: AccountDeletionContext,
): Promise<AccountDeletionResult> {
  // Filesystem cleanup cannot share atomicity with the DB transaction below
  // (a rollback can't "undelete" an unlinked file), so stored files are only
  // collected inside the transaction, while the owning rows still exist, and
  // recorded there as durable purge items (A-34). The deletion runs AFTER the
  // transaction commits; a process that stops first leaves the items for the
  // boot drain. See settings.account-deletion.purge.ts.
  const { householdId } = ctx;
  const purgeIds: string[] = [];
  const exportIds: string[] = [];

  const result = await withTransaction(async (tx) => {
    // 0. Acquire every current/historical SIP anchor before member/user locks.
    //    Keep the existing current-membership precondition (Gap 1).
    const sipHouseholds = await lockSipErasureHouseholds(tx, ctx.userId, householdId);
    if (householdId) await assertSingleHousehold(tx, ctx.userId, householdId);

    // 1. Lock this household's member rows before the identity lock.
    const lockedMembers = householdId ? await lockHouseholdMembers(tx, householdId) : [];

    // A-20: with no household, serialise with this user's joins (invite
    // accept, household create) on the per-user membership lock, in their
    // order: household rows, then this lock, then the users row.
    if (!householdId) await lockUserMembership(tx, ctx.userId);

    // Fence actor grant writers and reject any newly unbound household before
    // membership deletion, financial deletion or collecting post-commit files.
    const lockedEmail = await lockSipErasureIdentity(tx, ctx.userId, householdId, sipHouseholds);
    if (!householdId) await assertNoHousehold(tx, ctx.userId);
    exportIds.push(...(await erasePersonalExports(tx, ctx.userId)));

    // The erased user's own uploads (profile banner + profile picture).
    // Resolve them to their stored objects FIRST: a household delete below
    // cascades the storage_objects manifest rows, after which their keys are
    // unknowable, and anonymiseUser later clears users.banner_url /
    // users.profile_picture_url.
    purgeIds.push(...(await recordPurgeItems(tx, await collectUserUploadPaths(tx, ctx.userId, householdId))));

    // 2. Decide the household's fate from the locked snapshot.
    const outcome: HouseholdOutcome = householdId
      ? await settleHousehold(tx, ctx.userId, householdId, lockedMembers)
      : { householdDeleted: false, ownerSuccessorUserId: null, purgeIds: [] };
    purgeIds.push(...outcome.purgeIds);

    // 3. Irreversibly anonymise the user row (kept for audit-actor reference).
    //    The user's own uploads were collected above, before any cascade.
    const tombstoneEmail = await anonymiseUser(tx, ctx.userId);
    await pseudonymiseErasedIdentity(tx, ctx.userId, lockedEmail, tombstoneEmail);
    await eraseActorAiTraces(tx, ctx.userId);

    // 4. Durable erasure audit record, written through this transaction so it
    //    is atomic with the deletion and not itself erased. Scoped to no
    //    household so it outlives a deleted household row.
    await businessAuditService.log({
      tx,
      householdId: null,
      userId: ctx.userId,
      action: "DELETE",
      entityType: "user_account",
      entityId: ctx.userId,
      details: {
        reason: "right_to_erasure",
        erasedHouseholdId: householdId,
        householdDeleted: outcome.householdDeleted,
        ownerSuccessorUserId: outcome.ownerSuccessorUserId,
      },
      ipAddress: ctx.ipAddress,
    });

    return { householdDeleted: outcome.householdDeleted };
  });

  // The erasure is durable: stop the erased actor's in-flight Thandi provider
  // calls in this process (R17 follow-up); the exchange fence refuses any
  // late answer from elsewhere.
  abortActorInFlight(ctx.userId);

  // Only reached once the transaction above has committed. Best-effort: a
  // failure to remove a file is logged and audited, and its purge item stays
  // queued, but it never turns an already-durable erasure into a user-facing
  // failure.
  await recordErasedFileFailures(ctx.userId, await drainErasurePurgeItems(purgeIds));
  await removeErasedExportFiles(exportIds);

  return result;
}
