/**
 * Account Archive Service
 *
 * Handles account archive/unarchive operations.
 * Split from AccountCoreService to maintain LOC limits.
 *
 * @module services/account/AccountArchiveService
 */

import type { Account } from "@shared/schema";
import { accountRepository } from "../../repositories/AccountRepository";
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";
import {
  AuthorizationError,
  NotFoundError,
} from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";

type ArchiveOperation = "archive" | "unarchive";

/**
 * Archive or unarchive one account and write its single audit row in the same
 * transaction (NEW-32): a failed audit insert rolls the change back.
 *
 * Uses a TOCTOU-safe ownership check in the WHERE clause, so a visibility
 * change between the check and the write cannot touch another user's account.
 */
async function setArchived(
  operation: ArchiveOperation,
  id: string,
  householdId: string,
  userId: string,
  ipAddress?: string,
): Promise<Account> {
  // Initial visibility check (privacy-preserving: missing and hidden are both 404)
  const existing = await accountRepository.findByIdWithVisibility(id, householdId, userId);
  if (!existing) {
    throw new NotFoundError("Account not found");
  }
  if (existing.isPrivate && existing.ownerUserId !== userId) {
    throw new AuthorizationError(`Only the owner can ${operation} a private account`);
  }

  const isArchived = operation === "archive";
  const account = await withTransaction(async (tx) => {
    // Household first: the audit row's household FK takes a key-share lock on it.
    await lockAccountHousehold(tx, householdId);
    // The audit's before-state is read under the account row lock.
    const before = await accountRepository.lockForAudit(tx, id, householdId);
    if (!before) {
      throw new NotFoundError("Account not found");
    }
    const { account: changed, unauthorized } = isArchived
      ? await accountRepository.archive(id, householdId, { userId }, tx)
      : await accountRepository.unarchive(id, householdId, { userId }, tx);
    if (unauthorized) {
      throw new AuthorizationError(`Cannot ${operation} private account owned by another user`);
    }
    if (!changed) {
      throw new NotFoundError("Account not found");
    }
    await businessAuditService.logUpdate({
      tx,
      householdId: changed.isPrivate ? null : householdId,
      userId,
      entityType: "account",
      entityId: id,
      oldValue: { isArchived: before.isArchived },
      newValue: { isArchived: changed.isArchived },
      ipAddress,
      metadata: { operation },
    });
    return changed;
  });

  logger.info(isArchived ? "Account archived" : "Account unarchived", { householdId, accountId: id });
  return account;
}

/** Archive an account (one audit row, in the write's transaction). */
export function archiveAccount(id: string, householdId: string, userId: string, ipAddress?: string): Promise<Account> {
  return setArchived("archive", id, householdId, userId, ipAddress);
}

/** Unarchive an account (one audit row, in the write's transaction). */
export function unarchiveAccount(id: string, householdId: string, userId: string, ipAddress?: string): Promise<Account> {
  return setArchived("unarchive", id, householdId, userId, ipAddress);
}
