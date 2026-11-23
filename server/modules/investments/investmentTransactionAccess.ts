import { and, eq, sql } from "drizzle-orm";
import { accounts, holdings, householdMembers, households, securities, users, type User } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../../core/errors";
import { lockCurrentSessionCredential } from "../../services/session-identity";
import { securityVisibleTo } from "../../services/investment/securityCatalogueScope";
import type { CreateInvestmentTransactionInput } from "./investments.validation";

export interface InvestmentSourceSession { snapshot: User; sessionId: string; generation?: number }

/** Match household erasure's anchor, then grant/identity -> holding -> account
 * -> instrument. Keep the source audience and units locked through history,
 * FIFO, quantity and audit writes; preflight HTTP checks confer no late grant. */
export async function lockInvestmentWriterIdentity(tx: TransactionType, caller: HouseholdContext, session?: InvestmentSourceSession) {
  if (!caller?.householdId || !caller.userId) throw new ForbiddenError("Financial write access required");
  if (session && (session.snapshot?.id !== caller.userId || !session.sessionId)) throw new UnauthorizedError("Authentication changed; sign in again");
  const [household] = await tx.select({ id: households.id }).from(households).where(eq(households.id, caller.householdId)).for("share");
  if (!household) throw new NotFoundError("Account");
  const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers).where(and(
    eq(householdMembers.householdId, caller.householdId), eq(householdMembers.userId, caller.userId),
  )).for("share");
  if (!grant || !can(grant.role, "financial.write")) throw new ForbiddenError("Financial write access required");
  if (session) {
    // Membership -> current credential -> actual SID is the established
    // mutation order. A selected-device revoke need not change the user tuple.
    const current = await lockCurrentSessionCredential(tx, session.snapshot, session.sessionId, session.generation);
    const persisted = await tx.execute(sql`select sid from "session" where sid = ${session.sessionId} and expire >= now()
      and sess->>'userId' = ${current.id} and coalesce(sess->>'securityGeneration', '0') = ${String(current.securityGeneration)} for share`);
    if (persisted.rows.length !== 1) throw new UnauthorizedError("Authentication changed; sign in again");
  }
  const [identity] = await tx.select({ erasedAt: users.erasedAt, emailVerified: users.emailVerified }).from(users).where(eq(users.id, caller.userId)).for("share");
  if (!identity || identity.erasedAt || !identity.emailVerified) {
    throw new ForbiddenError("Financial write access required");
  }
  return { ...caller, role: grant.role };
}

export async function lockInvestmentTransactionSources(tx: TransactionType, caller: HouseholdContext,
  data: Pick<CreateInvestmentTransactionInput, "accountId" | "holdingId" | "securityId">, session?: InvestmentSourceSession) {
  const actor = await lockInvestmentWriterIdentity(tx, caller, session);
  // Preserve the established Account-before-Holding response without taking
  // an account lock ahead of the holding. The locked read below is authoritative.
  const [candidate] = await tx.select({ id: accounts.id }).from(accounts).where(and(
    eq(accounts.id, data.accountId), visibleAccountPredicate(actor),
  ));
  if (!candidate) throw new NotFoundError("Account");
  const [holding] = data.holdingId ? await tx.select().from(holdings).where(and(
    eq(holdings.id, data.holdingId), eq(holdings.householdId, caller.householdId), eq(holdings.accountId, data.accountId),
    data.securityId ? eq(holdings.securityId, data.securityId) : undefined,
  )).for("update") : [];
  const [account] = await tx.select().from(accounts).where(and(eq(accounts.id, data.accountId), eq(accounts.householdId, caller.householdId))).for("share");
  if (!account || account.deletedAt || (account.isPrivate && account.ownerUserId !== caller.userId)) throw new NotFoundError("Account");
  if (data.holdingId && (!holding || holding.accountId !== data.accountId.toLowerCase() ||
    (data.securityId && holding.securityId !== data.securityId.toLowerCase()))) throw new NotFoundError("Holding");
  const securityId = holding?.securityId ?? data.securityId;
  if (securityId) {
    const [security] = await tx.select({ id: securities.id }).from(securities)
      .where(and(eq(securities.id, securityId), securityVisibleTo(caller.householdId))).for("share");
    if (!security) throw new NotFoundError("Security");
  }
  return { actor, account, holding };
}
