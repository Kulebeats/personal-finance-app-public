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
import {
  AuthorizationError,
  NotFoundError,
} from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { businessAuditService } from "../BusinessAuditService";

/**
 * Archive an account
 *
 * Uses TOCTOU-safe ownership check in the WHERE clause to prevent race
 * conditions where visibility could change between the check and archive.
 */
export async function archiveAccount(
  id: string,
  householdId: string,
  userId: string,
): Promise<Account> {
  // Initial visibility check (for user-friendly error messages)
  const existing = await accountRepository.findByIdWithVisibility(
    id,
    householdId,
    userId,
  );
  if (!existing) {
    throw new NotFoundError("Account not found");
  }

  // Check ownership for private accounts
  if (existing.isPrivate && existing.ownerUserId !== userId) {
    throw new AuthorizationError(
      "Only the owner can archive a private account",
    );
  }

  // Use atomic ownership check for TOCTOU-safe archive
  const { account, unauthorized } = await accountRepository.archive(
    id,
    householdId,
    { userId }, // Ownership check: must be public OR owned by this user
  );

  if (unauthorized) {
    throw new AuthorizationError(
      "Cannot archive private account owned by another user",
    );
  }

  if (!account) {
    throw new NotFoundError("Account not found");
  }

  // Audit logging
  await businessAuditService.logUpdate({
    householdId,
    userId,
    entityType: "account",
    entityId: id,
    oldValue: { isArchived: false },
    newValue: { isArchived: true },
  });

  logger.info("Account archived", { householdId, accountId: id });

  return account;
}

/**
 * Unarchive an account
 *
 * Uses TOCTOU-safe ownership check in the WHERE clause to prevent race
 * conditions where visibility could change between the check and unarchive.
 */
export async function unarchiveAccount(
  id: string,
  householdId: string,
  userId: string,
): Promise<Account> {
  // Check visibility first (privacy-preserving check)
  const existing = await accountRepository.findByIdWithVisibility(
    id,
    householdId,
    userId,
  );

  if (!existing) {
    // Returns NotFoundError for both missing AND not-visible (privacy-preserving)
    throw new NotFoundError("Account not found");
  }

  // Owner check for private accounts
  if (existing.isPrivate && existing.ownerUserId !== userId) {
    throw new AuthorizationError(
      "Only the owner can unarchive a private account",
    );
  }

  // Use atomic ownership check for TOCTOU-safe unarchive
  const { account, unauthorized } = await accountRepository.unarchive(
    id,
    householdId,
    { userId }, // Ownership check: must be public OR owned by this user
  );

  if (unauthorized) {
    throw new AuthorizationError(
      "Cannot unarchive private account owned by another user",
    );
  }

  if (!account) {
    throw new NotFoundError("Account not found");
  }

  // Audit logging
  await businessAuditService.logUpdate({
    householdId,
    userId,
    entityType: "account",
    entityId: id,
    oldValue: { isArchived: true },
    newValue: { isArchived: false },
  });

  logger.info("Account unarchived", { householdId, accountId: id });

  return account;
}
