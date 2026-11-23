import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { accounts, categories, householdMembers, tags, transactions, transactionTags } from "@shared/schema";
import { db } from "../db";
import { can } from "../core/authz/capabilities";
import { visibleAccountPredicate, visibleTransactionPredicate } from "../core/authz/transaction-visibility";
import { ForbiddenError, NotFoundError } from "../core/errors";
import { businessAuditService } from "../services/BusinessAuditService";
import { couponCashDescriptionFields } from "../services/grz/couponCashDescription";

export function readAccountTransactionExport(
  accountId: string,
  householdId: string,
  userId: string,
  dates: { startDate?: string; endDate?: string },
) {
  return db.transaction(async tx => {
    const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).for("share");
    if (!member || !can(member.role, "financial.export")) throw new ForbiddenError("Financial export access required");
    const actor = { householdId, userId, role: member.role };
    const [account] = await tx.select({ id: accounts.id, householdId: accounts.householdId, name: accounts.name,
      currency: accounts.currency, isAsset: accounts.isAsset }).from(accounts)
      .where(and(eq(accounts.id, accountId), visibleAccountPredicate(actor)));
    if (!account) throw new NotFoundError("Account not found");

    // R1-05: GRZ coupon and T-bill interest cash read as the ledger does (custody shared, else generic).
    const cash = couponCashDescriptionFields();
    const rows = await tx.select({
      id: transactions.id, date: transactions.date, name: cash.name, amount: transactions.amount,
      type: transactions.type, currency: transactions.currency, isTransferIn: transactions.isTransferIn,
      isBalanceAdjustmentIncrease: transactions.isBalanceAdjustmentIncrease,
      originalName: cash.originalName, notes: cash.notes, categoryName: categories.name,
      tags: sql<string[]>`COALESCE(array_agg(${tags.name} ORDER BY ${tags.name}) FILTER (WHERE ${tags.name} IS NOT NULL), ARRAY[]::text[])`,
    }).from(transactions)
      .leftJoin(categories, and(eq(transactions.categoryId, categories.id), eq(categories.householdId, householdId)))
      .leftJoin(transactionTags, eq(transactionTags.transactionId, transactions.id))
      .leftJoin(tags, and(eq(tags.id, transactionTags.tagId), eq(tags.householdId, householdId)))
      .where(and(
        eq(transactions.accountId, accountId), visibleTransactionPredicate(actor),
        dates.startDate ? gte(transactions.date, dates.startDate) : undefined,
        dates.endDate ? lte(transactions.date, dates.endDate) : undefined,
      ))
      .groupBy(transactions.id, categories.name)
      .orderBy(desc(transactions.date), transactions.id);
    // Match owner edits: sorted cash rows, then containing account. RR locking
    // rejects a privacy/source update since the read cut before the audit.
    if (rows.length) await tx.select({ id: transactions.id }).from(transactions)
      .where(sql`${transactions.id} = ANY(${sql.param(rows.map(row => row.id))}::uuid[])`).orderBy(transactions.id).for("share");
    const [lockedAccount] = await tx.select({ id: accounts.id }).from(accounts)
      .where(and(eq(accounts.id, accountId), visibleAccountPredicate(actor))).for("share");
    if (!lockedAccount) throw new NotFoundError("Account not found");
    await businessAuditService.log({ tx, householdId: null, userId, action: "PROCESS", entityType: "data_export", entityId: accountId,
      details: { exportType: "account_transactions", fileFormat: "csv", recordCount: rows.length } });
    return { account, rows };
  }, { isolationLevel: "repeatable read" });
}
