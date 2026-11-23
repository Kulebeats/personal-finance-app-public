import { and, eq } from "drizzle-orm";
import { accounts, householdMembers } from "@shared/schema";
import { can, type Capability } from "../core/authz/capabilities";
import { visibleAccountPredicate } from "../core/authz/transaction-visibility";
import { ForbiddenError, HttpError, NotFoundError } from "../core/errors";
import type { TransactionType } from "../utils/withTransaction";

export class AccountFinancialDataUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "FINANCIAL_DATA_UNAVAILABLE";
  constructor() { super("Required valuation data is unavailable for visible account-linked wealth"); }
}

export async function readAccountActor(tx: TransactionType, householdId: string, userId: string, capability: Capability) {
  const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).limit(1);
  if (!member || !can(member.role, capability)) throw new ForbiddenError("Account financial access denied");
  return { householdId, userId, role: member.role };
}

export async function readVisibleAccounts(tx: TransactionType, actor: Awaited<ReturnType<typeof readAccountActor>>) {
  return tx.select().from(accounts).where(visibleAccountPredicate(actor)).orderBy(accounts.displayOrder, accounts.id);
}

export async function readVisibleAccount(tx: TransactionType, actor: Awaited<ReturnType<typeof readAccountActor>>, accountId: string) {
  const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, accountId), visibleAccountPredicate(actor))).limit(1);
  if (!account) throw new NotFoundError("Account");
  return account;
}
