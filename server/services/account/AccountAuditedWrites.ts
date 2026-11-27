/**
 * Account Audited Writes
 *
 * NEW-32 / FIN-13: an account update, settings change or delete and its one
 * audit row commit in the same transaction. A failed audit insert rolls the
 * write back, so a regulated write never commits unlogged. The before-state is
 * read under the row lock the write holds.
 *
 * @module services/account/AccountAuditedWrites
 */

import type { Account } from "@shared/schema";
import { accountRepository } from "../../repositories/AccountRepository";
import { lockAccountHousehold } from "../../repositories/AccountCreationGrant";
import { NotFoundError } from "../../utils/errorHandler";
import { withTransaction, type TransactionType } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";
import { AccountImportService } from "./AccountImportService";

type AccountSettings = { isHidden?: boolean; excludeFromNetWorth?: boolean; hideTransactions?: boolean };

/** A private account's audit row is owner-only (no household), as on create. */
function auditHousehold(householdId: string, ...rows: Account[]): string | null {
  return rows.some(row => row.isPrivate) ? null : householdId;
}

// C3-16: an opening-basis edit moves initialBalance with balance, so both are
// recorded. Rows written before this carry no initialBalance: read it as unknown.
const profile = (row: Account) => ({
  name: row.name, type: row.type, initialBalance: row.initialBalance, balance: row.balance, currency: row.currency,
  isArchived: row.isArchived,
  isPrivate: row.isPrivate, ownerUserId: row.ownerUserId, institution: row.institution, notes: row.notes,
});
const visibility = (row: Account) => ({
  isHidden: row.isHidden, excludeFromNetWorth: row.excludeFromNetWorth, hideTransactions: row.hideTransactions,
});

export class AccountAuditedWriteService extends AccountImportService {
  /** Household first (the audit FK key-shares it), then the account row. */
  private async lockBefore(tx: TransactionType, id: string, householdId: string): Promise<Account> {
    await lockAccountHousehold(tx, householdId);
    const before = await accountRepository.lockForAudit(tx, id, householdId);
    if (!before) throw new NotFoundError("Account not found");
    return before;
  }

  async updateAccountAudited(id: string, data: Partial<Account>, householdId: string, userId: string,
    expectedUpdatedAt?: Date, ipAddress?: string): Promise<Account> {
    return withTransaction(async (tx) => {
      // Only the account row here: a custody change locks household -> members
      // inside updateAccount, after the route's grant admission, so a grant
      // revoked in between is still seen (A-59). Member writers never lock accounts.
      const before = await accountRepository.lockForAudit(tx, id, householdId);
      if (!before) throw new NotFoundError("Account not found");
      const account = await this.updateAccount(id, data, householdId, userId, expectedUpdatedAt, tx);
      await businessAuditService.logUpdate({
        tx, userId, householdId: auditHousehold(householdId, before, account), entityId: id, entityType: "account",
        oldValue: profile(before), newValue: profile(account), ipAddress,
      });
      return account;
    });
  }

  async updateAccountSettingsAudited(id: string, settings: AccountSettings, householdId: string, userId: string,
    ipAddress?: string): Promise<Account> {
    return withTransaction(async (tx) => {
      const before = await this.lockBefore(tx, id, householdId);
      const account = await this.updateAccountSettings(id, settings, householdId, userId, tx);
      await businessAuditService.logUpdate({
        tx, userId, householdId: auditHousehold(householdId, before, account), entityId: id, entityType: "account",
        oldValue: visibility(before), newValue: visibility(account), ipAddress, metadata: { operation: "updateSettings" },
      });
      return account;
    });
  }

  async deleteAccountAudited(id: string, householdId: string, userId: string, ipAddress?: string): Promise<void> {
    await withTransaction(async (tx) => {
      const before = await this.lockBefore(tx, id, householdId);
      await this.deleteAccount(id, householdId, userId, tx);
      await businessAuditService.logDelete({
        tx, userId, householdId: auditHousehold(householdId, before), entityId: id, entityType: "account",
        oldValue: { name: before.name, type: before.type, initialBalance: before.initialBalance, balance: before.balance,
          currency: before.currency, isArchived: before.isArchived },
        ipAddress,
      });
    });
  }
}
