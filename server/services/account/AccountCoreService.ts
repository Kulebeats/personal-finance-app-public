import {
  type Account,
  type InsertAccount,
  accountTypeEnum,
} from "@shared/schema";
import { Money } from "../../core/money";
import { accountRepository } from "../../repositories/AccountRepository";
import { householdRepository } from "../../repositories/HouseholdRepository";
import { transactionRepository } from "../../repositories/TransactionRepository";
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../utils/errorHandler";
import { logger } from "../../utils/logger";
import { type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import {
  archiveAccount as archiveAccountFn,
  unarchiveAccount as unarchiveAccountFn,
} from "./AccountArchiveService";

/**
 * AccountService
 *
 * Business logic layer for account operations.
 * Implements Phase 1 requirements:
 * - Privacy/visibility enforcement
 * - Balance adjustment via transactions
 * - Validation rules
 */
export class AccountCoreService {
  /**
   * Get all accounts visible to the user
   */
  async getAccounts(
    householdId: string,
    userId: string,
    options?: {
      includeArchived?: boolean;
      includeHidden?: boolean;
      ownerUserId?: string | null;
    },
  ): Promise<Account[]> {
    return await accountRepository.findByHouseholdWithVisibility(
      householdId,
      userId,
      options,
    );
  }

  /**
   * Get a single account with visibility check
   */
  async getAccountById(
    id: string,
    householdId: string,
    userId: string,
  ): Promise<Account> {
    const account = await accountRepository.findByIdWithVisibility(
      id,
      householdId,
      userId,
    );

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    return account;
  }

  /**
   * Create a new account
   *
   * TODO-004: ownerUserId can now be specified in input.
   * - Defaults to creator (userId) if not provided
   * - Admin/owner can assign to other household members
   * - Members can only assign to themselves
   */
  async createAccount(
    data: Omit<InsertAccount, "householdId" | "ownerUserId"> & {
      ownerUserId?: string | null;
    },
    householdId: string,
    userId: string,
  ): Promise<Account> {
    // Get next display order
    const displayOrder =
      await accountRepository.getNextDisplayOrder(householdId);

    // Validate account type using schema as source of truth
    const validTypes = accountTypeEnum.enumValues;
    if (!validTypes.includes(data.type as (typeof validTypes)[number])) {
      throw new ValidationError("Invalid account type", [
        { field: "type", message: `Must be one of: ${validTypes.join(", ")}` },
      ]);
    }

    // Determine owner: use provided or default to creator
    const ownerUserId = data.ownerUserId ?? userId;

    // TODO-004: Validate owner assignment
    if (data.ownerUserId && data.ownerUserId !== userId) {
      // Check creator's role - only admin/owner can assign to others
      const creatorMember = await householdRepository.findMember(
        householdId,
        userId,
      );
      if (!creatorMember || !["owner", "admin"].includes(creatorMember.role)) {
        throw new AuthorizationError(
          "Only admins can create accounts for other members",
        );
      }

      // Validate target user is a household member
      const targetMember = await householdRepository.findMember(
        householdId,
        data.ownerUserId,
      );
      if (!targetMember) {
        throw new ValidationError("Owner must be a household member", [
          { field: "ownerUserId", message: "User is not a member of this household" },
        ]);
      }
    }

    // Validate private accounts must have an owner (TODO-017)
    if (data.isPrivate && !ownerUserId) {
      throw new ValidationError("Private accounts must have an owner");
    }

    // Determine if asset based on type (includes mortgage and other_liability)
    const liabilityTypes = ["credit", "loan", "mortgage", "other_liability"];
    const isAsset = !liabilityTypes.includes(data.type);

    const account = await accountRepository.create({
      ...data,
      householdId,
      ownerUserId,
      displayOrder,
      isAsset,
      balance: data.initialBalance || "0",
    });

    // TODO-004: Audit log with ownership details
    await businessAuditService.logCreate({
      householdId,
      userId,
      entityType: "account",
      entityId: account.id,
      newValue: {
        name: account.name,
        type: account.type,
        ownerUserId,
        createdBy: userId,
        assignedToOther: ownerUserId !== userId,
      },
    });

    logger.info("Account created", {
      householdId,
      userId,
      ownerUserId,
    });

    return account;
  }

  /**
   * Update an account with optimistic concurrency
   *
   * TODO-026: TOCTOU Mitigation
   * The visibility/privacy check happens before update, creating a theoretical
   * race condition. However, this is mitigated by:
   * 1. Optimistic concurrency: expectedUpdatedAt ensures any changes between
   *    the check and update will trigger a ConflictError
   * 2. The repository update uses WHERE clause matching the account ID
   * 3. For critical privacy changes, audit logging captures the state
   *
   * For higher security, consider SELECT FOR UPDATE in a transaction.
   */
  async updateAccount(
    id: string,
    data: Partial<Account>,
    householdId: string,
    userId: string,
    expectedUpdatedAt?: Date,
    tx?: TransactionType,
  ): Promise<Account> {
    // First verify visibility/access
    // Note: TOCTOU risk is mitigated by optimistic concurrency (expectedUpdatedAt)
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
        "Cannot modify private account owned by another user",
      );
    }

    // Prevent direct balance modification (must use adjustBalance)
    if (data.balance !== undefined) {
      throw new ValidationError(
        "Cannot directly modify balance. Use adjust-balance endpoint.",
        [
          { field: "balance", message: "Use POST /accounts/:id/adjust-balance instead" },
        ],
      );
    }

    // TODO-026: Pass ownership check to repository for TOCTOU-safe update
    // TODO-018: Pass tx for transactional bulk operations
    const { account, conflict, unauthorized } = await accountRepository.update(
      id,
      householdId,
      data,
      expectedUpdatedAt,
      { userId }, // ownershipCheck: account must be public OR owned by this user
      tx,
    );

    // TODO-026: Handle unauthorized (privacy changed between check and update)
    if (unauthorized) {
      throw new AuthorizationError(
        "Cannot modify private account owned by another user",
      );
    }

    if (conflict) {
      throw new ConflictError(
        "Account was modified by another user. Please refresh and try again.",
      );
    }

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    logger.info("Account updated", { householdId });

    return account;
  }

  /**
   * Soft delete an account
   *
   * TODO-026: TOCTOU Mitigation
   * Uses atomic ownership check in the WHERE clause to prevent race condition
   * where visibility could change between the check and the delete.
   */
  async deleteAccount(
    id: string,
    householdId: string,
    userId: string,
  ): Promise<void> {
    // Initial visibility check (for user-friendly error messages)
    const existing = await accountRepository.findByIdWithVisibility(
      id,
      householdId,
      userId,
    );

    if (!existing) {
      throw new NotFoundError("Account not found");
    }

    // TODO-026: Use atomic ownership check for TOCTOU-safe delete
    // Even if visibility changed between the check above and now,
    // the WHERE clause will prevent deletion of other users' private accounts
    const { deleted, unauthorized } = await accountRepository.softDelete(
      id,
      householdId,
      { userId }, // Ownership check: must be public OR owned by this user
    );

    if (unauthorized) {
      throw new AuthorizationError(
        "Cannot delete private account owned by another user",
      );
    }

    if (!deleted) {
      throw new NotFoundError("Account not found");
    }

    logger.info("Account deleted", { householdId });
  }

  /**
   * Adjust account balance by creating a balance_adjustment transaction
   * Per Canonical Invariant 6: balances updated only via service layer
   * FIX DATA-ACCOUNT-001: Use Money class for precise arithmetic
   */
  async adjustBalance(
    accountId: string,
    amount: string,
    isIncrease: boolean,
    householdId: string,
    userId: string,
    notes?: string,
  ): Promise<{ account: Account; transactionId: string }> {
    // Verify account access
    const existingAccount = await accountRepository.findByIdWithVisibility(
      accountId,
      householdId,
      userId,
    );

    if (!existingAccount) {
      throw new NotFoundError("Account not found");
    }

    // FIX DATA-ACCOUNT-001: Validate using Money class
    const amountMoney = new Money(amount);
    if (!amountMoney.gt(0)) {
      throw new ValidationError("Amount must be positive", [
        { field: "amount", message: "Must be greater than 0" },
      ]);
    }

    // Route through the locked transaction-create path: it takes the account
    // FOR UPDATE, applies the overdraft guard (balance-reducing deltas only),
    // and writes the balance atomically — this path previously did its own
    // unlocked, unguarded balance write.
    const { transaction, account } = await transactionRepository.create({
      householdId,
      accountId,
      ownerUserId: userId,
      date: new Date().toISOString().split("T")[0],
      name: isIncrease
        ? "Balance Adjustment (Increase)"
        : "Balance Adjustment (Decrease)",
      amount: amount, // FIX DATA-ACCOUNT-001: Already a string
      currency: existingAccount.currency,
      type: "balance_adjustment" as const,
      isBalanceAdjustmentIncrease: isIncrease,
      source: "manual" as const,
      notes,
    });

    logger.info("Balance adjusted", {
      householdId,
    });

    return { account, transactionId: transaction.id };
  }

  /**
   * Archive an account
   * Delegates to AccountArchiveService
   */
  async archiveAccount(
    id: string,
    householdId: string,
    userId: string,
  ): Promise<Account> {
    return archiveAccountFn(id, householdId, userId);
  }

  /**
   * Unarchive an account
   * Delegates to AccountArchiveService
   */
  async unarchiveAccount(
    id: string,
    householdId: string,
    userId: string,
  ): Promise<Account> {
    return unarchiveAccountFn(id, householdId, userId);
  }

  /**
   * Update account visibility settings
   */
  async updateAccountSettings(
    id: string,
    settings: {
      isHidden?: boolean;
      excludeFromNetWorth?: boolean;
      hideTransactions?: boolean;
    },
    householdId: string,
    userId: string,
  ): Promise<Account> {
    // Verify access
    const existing = await accountRepository.findByIdWithVisibility(
      id,
      householdId,
      userId,
    );

    if (!existing) {
      throw new NotFoundError("Account not found");
    }

    // Only update provided fields
    const updateData: Partial<Account> = {};
    if (settings.isHidden !== undefined)
      updateData.isHidden = settings.isHidden;
    if (settings.excludeFromNetWorth !== undefined)
      updateData.excludeFromNetWorth = settings.excludeFromNetWorth;
    if (settings.hideTransactions !== undefined)
      updateData.hideTransactions = settings.hideTransactions;

    const { account } = await accountRepository.update(
      id,
      householdId,
      updateData,
    );

    if (!account) {
      throw new NotFoundError("Account not found");
    }

    return account;
  }
}
