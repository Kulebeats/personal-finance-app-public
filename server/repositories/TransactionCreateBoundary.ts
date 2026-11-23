import { accounts, categories, householdMembers, merchants, type Account, type InsertTransaction } from "@shared/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { ensureMerchantAlias } from "../services/merchantRecognition";
import { ForbiddenError, NotFoundError } from "../utils/errorHandler";
import type { TransactionRunner, TransactionType } from "../utils/withTransaction";
import { can } from "../core/authz/capabilities";
import { visibleAccountPredicate } from "../core/authz/transaction-visibility";
import type { HouseholdContext } from "../middleware/householdGuard";
import { assertOrdinaryPrivacyOwner } from "../core/authz/ordinary-transaction-privacy";

import type { PostingMode } from "./TransactionPostingEffect";

export interface TransactionCreateOptions {
  accountImportTransaction?: TransactionRunner;
  couponPaymentId?: string;
  originalOwnerIntent?: { actorUserId: string; selectedOwnerId?: string | null; operation?: "recurring" | "account_import" | "grz_coupon"; requestDigest?: string };
  initialImportTagNames?: string[];
  postingMode?: PostingMode;
  publishCreatedEvent?: boolean;
  recurringActor?: { householdId: string; userId: string };
  createActor?: { householdId: string; userId: string };
  /** Ordinary initial creates validate their posted top-level references in tx. */
  validateReferences?: boolean;
  /** Learned aliases commit with the posting, including pointer-free creates. */
  merchantAlias?: { merchantId: string; aliasName: string };
  /** Preserve an explicit merchant through recognition so a fallback cannot authorize it. */
  requestedMerchantId?: string | null;
  audit?: {
    userId: string | null;
    householdId: string | null;
    ipAddress?: string;
    metadata?: Record<string, unknown>;
  };
}

/** Hold the live ordinary grant before the account lock through financial commit. */
export async function lockTransactionCreateGrant(
  tx: TransactionType, householdId: string, options?: TransactionCreateOptions,
): Promise<HouseholdContext | undefined> {
  const actor = options?.createActor;
  // Caller-owned repository transactions retain their existing authorization.
  if (!actor) return;
  if (actor.householdId !== householdId) throw new NotFoundError("Account not found");
  const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
    eq(householdMembers.householdId, householdId), eq(householdMembers.userId, actor.userId),
  )).for("share");
  if (!grant) throw new NotFoundError("Account not found");
  if (!can(grant.role, "financial.write")) throw new ForbiddenError("Financial write access required");
  return { householdId, userId: actor.userId, role: grant.role };
}

/** Authorize and prepare create side effects while the destination is locked. */
export async function prepareTransactionCreate(
  tx: TransactionType, lockedAccount: Account,
  references: Pick<InsertTransaction, "householdId" | "categoryId" | "merchantId" | "ownerUserId" | "isPrivate">,
  options?: TransactionCreateOptions,
  createActor?: HouseholdContext,
): Promise<void> {
  const { householdId } = references;
  assertOrdinaryPrivacyOwner(references, createActor?.userId ?? options?.recurringActor?.userId);
  if (createActor) {
    const [visibleAccount] = await tx.select({ id: accounts.id }).from(accounts).where(and(
      eq(accounts.id, lockedAccount.id), visibleAccountPredicate(createActor),
    ));
    if (!visibleAccount) throw new NotFoundError("Account not found");
  }
  // The service pre-read can precede a privacy change on a different account.
  // The recurring parent transaction retries stale locks before reaching here.
  if (options?.recurringActor && (
    options.recurringActor.householdId !== householdId ||
    (lockedAccount.isPrivate !== false && lockedAccount.ownerUserId !== options.recurringActor.userId)
  )) {
    throw new NotFoundError("Account not found");
  }
  if (options?.recurringActor || options?.validateReferences) {
    const actor = options.createActor ?? options.recurringActor;
    if (actor && references.ownerUserId != null && references.ownerUserId !== actor.userId) {
      const [owner] = await tx.select({ id: householdMembers.userId }).from(householdMembers).where(and(
        eq(householdMembers.householdId, householdId), eq(householdMembers.userId, references.ownerUserId),
      )).for("share");
      if (!owner) throw new NotFoundError("User is not a member of this household");
    }
    if (references.categoryId) {
      const [category] = await tx.select({ id: categories.id }).from(categories).where(and(
        eq(categories.id, references.categoryId), eq(categories.householdId, householdId), isNull(categories.deletedAt),
      )).for("share");
      if (!category) throw new NotFoundError("Category not found");
    }
    const merchantIds = Array.from(new Set([
      references.merchantId, options.requestedMerchantId, options.merchantAlias?.merchantId,
    ].filter((id): id is string => !!id).map(id => id.toLowerCase())));
    if (merchantIds.length) {
      const lockedMerchants = await tx.select({ id: merchants.id }).from(merchants).where(and(
        inArray(merchants.id, merchantIds), eq(merchants.householdId, householdId),
      )).orderBy(merchants.id).for("share");
      if (lockedMerchants.length !== merchantIds.length) throw new NotFoundError("Merchant not found");
    }
  }
  if (options?.merchantAlias) {
    await ensureMerchantAlias(options.merchantAlias.merchantId, options.merchantAlias.aliasName, tx);
  }
}
