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

import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../../services/BusinessAuditService";
import { ConflictError, NotFoundError } from "../../core/errors";
import { logger } from "../../utils/logger";
import {
  collectHouseholdUploadPaths,
  collectUserUploadPaths,
  deleteErasedFiles,
} from "./settings.account-deletion.files";
import {
  // household-scoped parents
  households,
  householdMembers,
  householdPreferences,
  householdInvitations,
  accounts,
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
  csdAccounts,
  // user-scoped
  users,
  userSessions,
  userLoginHistory,
  userPreferences,
  userAIPreferences,
  userDisplaySettings,
  userNotificationPreferences,
  userPushSubscriptions,
  userQuietHours,
  userTwoFactorAuth,
  passwordHistory,
} from "@shared/schema";

export interface AccountDeletionContext {
  userId: string;
  householdId: string;
  /** Original email, kept only to record a non-reversible deletion marker. */
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
  await tx
    .delete(investmentTransactions)
    .where(eq(investmentTransactions.householdId, householdId));
  await tx.delete(priceAlerts).where(eq(priceAlerts.householdId, householdId));
  await tx.delete(holdings).where(eq(holdings.householdId, householdId));

  // GRZ, pensions, recurring investments (children via parent subquery).
  await tx
    .delete(grzBondPayments)
    .where(inArray(grzBondPayments.bondId, byHH(grzBonds)));
  await tx.delete(grzBonds).where(eq(grzBonds.householdId, householdId));
  await tx.delete(grzTBills).where(eq(grzTBills.householdId, householdId));
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
    .delete(pendingReceipts)
    .where(eq(pendingReceipts.householdId, householdId));
  await tx
    .delete(notifications)
    .where(eq(notifications.householdId, householdId));
  await tx.delete(outboxEvents).where(eq(outboxEvents.householdId, householdId));
}

/**
 * Irreversibly scrub all personal and financial-profile fields on the user
 * row, and rotate credentials to unusable random values. The row is retained
 * (not deleted) so the erasure audit record keeps a valid actor reference.
 */
async function anonymiseUser(
  tx: TransactionType,
  userId: string,
): Promise<void> {
  const marker = randomUUID();

  // Remove dependent user-scoped rows that hold PII or auth material.
  await tx.delete(userSessions).where(eq(userSessions.userId, userId));
  await tx.delete(userLoginHistory).where(eq(userLoginHistory.userId, userId));
  await tx.delete(passwordHistory).where(eq(passwordHistory.userId, userId));
  await tx
    .delete(userPushSubscriptions)
    .where(eq(userPushSubscriptions.userId, userId));
  await tx.delete(userQuietHours).where(eq(userQuietHours.userId, userId));
  await tx.delete(csdAccounts).where(eq(csdAccounts.userId, userId));
  await tx
    .delete(userTwoFactorAuth)
    .where(eq(userTwoFactorAuth.userId, userId));
  await tx.delete(userAIPreferences).where(eq(userAIPreferences.userId, userId));
  await tx.delete(userPreferences).where(eq(userPreferences.userId, userId));
  await tx
    .delete(userDisplaySettings)
    .where(eq(userDisplaySettings.userId, userId));
  await tx
    .delete(userNotificationPreferences)
    .where(eq(userNotificationPreferences.userId, userId));
  await tx.delete(notifications).where(eq(notifications.userId, userId));

  await tx
    .update(users)
    .set({
      username: `deleted_${marker}`,
      email: `deleted_${marker}@deleted.invalid`,
      passwordHash: `!erased!${marker}`,
      emailVerified: false,
      emailVerificationToken: null,
      emailVerificationExpiry: null,
      pendingEmail: null,
      fullName: null,
      firstName: null,
      lastName: null,
      displayName: null,
      birthday: null,
      gender: null,
      phoneNumber: null,
      phoneNumberMobile: null,
      phoneNumberWork: null,
      phoneNumberHome: null,
      address: null,
      occupation: null,
      company: null,
      profilePictureUrl: null,
      bannerUrl: null,
      bio: null,
      socialLinks: null,
      nrc: null,
      annualIncome: null,
      incomeFrequency: null,
      employmentStatus: null,
      investmentGoal: null,
      riskTolerance: null,
      salaryRangeEncrypted: null,
      profileCompleteness: 0,
      mfaEnabled: false,
      mfaMethod: null,
      mfaCode: null,
      mfaCodeExpiry: null,
      mfaBackupCodes: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * Pick the most-senior member (earliest `joinedAt`, then `userId` as a
 * deterministic tiebreak; null `joinedAt` sorts last) to inherit ownership when
 * the erased user was the household's sole owner and members remain.
 */
function pickSuccessor<T extends { userId: string; joinedAt: Date | null }>(
  members: readonly T[],
): T | undefined {
  return [...members].sort((a, b) => {
    const ta = a.joinedAt ? a.joinedAt.getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.joinedAt ? b.joinedAt.getTime() : Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  })[0];
}

/**
 * Lock the household row FOR UPDATE as the serialization anchor for erasure
 * (membership-lifecycle race, Gap 2). A concurrent acceptInvite/addMember for
 * the same household must serialize against this erasure instead of racing it:
 * without a shared lock, a sole-member erase and an invite acceptance share no
 * common row, and the joiner can be inserted into a household this erase then
 * deletes — silently cascade-removing the joiner (household_members.household_id
 * is ON DELETE CASCADE). acceptInvite takes the same lock; holding it here also
 * makes the member snapshot below sound — no new member can be inserted between
 * the snapshot and the fate decision. Throws if the household is already gone.
 */
async function lockHouseholdForErasure(
  tx: TransactionType,
  householdId: string,
): Promise<void> {
  const [householdRow] = await tx
    .select({ id: households.id })
    .from(households)
    .where(eq(households.id, householdId))
    .for("update")
    .limit(1);
  if (!householdRow) {
    throw new NotFoundError("Household not found");
  }
}

/**
 * Assert the user belongs ONLY to the resolved household (membership-lifecycle
 * race, Gap 1). Multi-household membership is not a supported state
 * (household.create rejects a second household; invitations.acceptInvite rejects
 * a user who already belongs to one), so the membership delete in eraseAccount is
 * scoped to the resolved household. If this user is somehow a member of ANOTHER
 * household, anonymising them here would leave that other household with a
 * scrubbed member (and, if they were its owner, no real owner) — so we fail
 * loudly rather than proceed. A plain read suffices: the household row is already
 * locked and the delete is scoped, so nothing here is orphaned; this is a
 * precondition tripwire, and locking the user's rows out of userId order would
 * risk a deadlock with the userId-ordered member lock below. The offending
 * household ids are logged server-side, not surfaced to the client.
 */
async function assertSingleHousehold(
  tx: TransactionType,
  userId: string,
  householdId: string,
): Promise<void> {
  const membershipRows = await tx
    .select({ membershipHouseholdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId));
  const otherHouseholdIds = [
    ...new Set(
      membershipRows
        .map((m) => m.membershipHouseholdId)
        .filter((id): id is string => id !== null && id !== householdId),
    ),
  ];
  if (otherHouseholdIds.length > 0) {
    logger.warn("Account erasure blocked: multi-household membership", {
      userId,
      householdId,
      otherHouseholdIds,
    });
    throw new ConflictError(
      "Account erasure blocked: this account belongs to more than one " +
        "household. Multi-household membership is not supported; resolve the " +
        "extra membership(s) before erasing this account.",
    );
  }
}

/**
 * Execute the full account erasure for a user inside one transaction. The
 * household's shared financial data is hard-deleted only when this user is the
 * last member out; while other members remain it is retained and, if needed,
 * ownership succeeds to the most-senior remaining member. The household row is
 * locked first as a serialization anchor against a concurrent invite-accept
 * (Gap 2), and single-household membership is asserted (Gap 1) before any
 * destructive write. Writes a durable erasure audit row.
 */
export async function eraseAccount(
  ctx: AccountDeletionContext,
): Promise<AccountDeletionResult> {
  // Filesystem cleanup cannot share atomicity with the DB transaction below
  // (a rollback can't "undelete" a unlinked file), so on-disk paths are only
  // collected here — inside the transaction, while the owning rows/columns
  // still exist — and the actual unlink runs AFTER the transaction commits,
  // once the erasure is durable. See settings.account-deletion.files.ts.
  const filesToDelete: string[] = [];

  const result = await withTransaction(async (tx) => {
    // 0. Serialization anchor (Gap 2) + single-household assertion (Gap 1),
    //    both before any destructive write so a violation rolls back cleanly.
    await lockHouseholdForErasure(tx, ctx.householdId);
    await assertSingleHousehold(tx, ctx.userId, ctx.householdId);

    // 1. Lock this household's member rows FOR UPDATE (ordered by userId,
    //    deadlock-safe) so the household-fate decision and any owner-succession
    //    write form one race-safe unit.
    const lockedMembers = await tx
      .select({
        userId: householdMembers.userId,
        role: householdMembers.role,
        joinedAt: householdMembers.joinedAt,
      })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, ctx.householdId))
      .orderBy(householdMembers.userId)
      .for("update");

    // 2. Remove this user's membership, SCOPED to the resolved household (Gap 1:
    //    not every household this user_id appears in), then decide the
    //    household-row fate from the locked snapshot.
    await tx
      .delete(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, ctx.householdId),
          eq(householdMembers.userId, ctx.userId),
        ),
      );

    const remainingMembers = lockedMembers.filter(
      (m) => m.userId !== ctx.userId,
    );

    let householdDeleted = false;
    let ownerSuccessorUserId: string | null = null;

    if (remainingMembers.length === 0) {
      // Sole member / last one out: the shared data has no other owner, so the
      // household-scoped financial rows, the household row, and its
      // preferences/invitations are all hard-deleted. Collect the upload
      // paths those rows reference BEFORE they're deleted below — this is
      // the last point they're readable.
      filesToDelete.push(
        ...(await collectHouseholdUploadPaths(tx, ctx.householdId)),
      );
      await deleteHouseholdFinancialData(tx, ctx.householdId);
      await tx
        .delete(householdPreferences)
        .where(eq(householdPreferences.householdId, ctx.householdId));
      await tx
        .delete(householdInvitations)
        .where(eq(householdInvitations.householdId, ctx.householdId));
      // Prior audit rows for this household are removed before we write the
      // durable erasure record (which is scoped to no household so it survives).
      await tx
        .delete(notifications)
        .where(eq(notifications.householdId, ctx.householdId));
      await tx.delete(households).where(eq(households.id, ctx.householdId));
      householdDeleted = true;
    } else if (!remainingMembers.some((m) => m.role === "owner")) {
      // Other members remain: the jointly-owned shared data is RETAINED. The
      // erased user was the only owner, so promote the most-senior remaining
      // member, else the household would be ungovernable (governance needs an
      // owner). userId is nullable at the type level, so only real ids inherit.
      const candidates: { userId: string; joinedAt: Date | null }[] = [];
      for (const m of remainingMembers) {
        if (m.userId !== null) {
          candidates.push({ userId: m.userId, joinedAt: m.joinedAt });
        }
      }
      const successor = pickSuccessor(candidates);
      if (successor) {
        await tx
          .update(householdMembers)
          .set({ role: "owner" })
          .where(
            and(
              eq(householdMembers.householdId, ctx.householdId),
              eq(householdMembers.userId, successor.userId),
            ),
          );
        ownerSuccessorUserId = successor.userId;
      }
    }

    // 3. Irreversibly anonymise the user row (kept for audit-actor reference).
    //    Collect the erased user's own uploads (profile banner + profile
    //    picture) BEFORE anonymiseUser clears users.banner_url /
    //    users.profile_picture_url below.
    filesToDelete.push(
      ...(await collectUserUploadPaths(tx, ctx.userId, ctx.householdId)),
    );
    await anonymiseUser(tx, ctx.userId);

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
        erasedHouseholdId: ctx.householdId,
        householdDeleted,
        ownerSuccessorUserId,
      },
      ipAddress: ctx.ipAddress,
    });

    return { householdDeleted };
  });

  // Only reached once the transaction above has committed. Best-effort: a
  // failure to remove a file from disk is logged but never thrown, so it can
  // never turn an already-durable erasure into a user-facing failure.
  await deleteErasedFiles(filesToDelete);

  return result;
}
