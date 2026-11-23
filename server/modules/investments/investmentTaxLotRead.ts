import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { accounts, holdings, householdMembers, investmentTransactions, securities, taxLotDisposals, taxLots, users, type TaxLotDisposal } from "@shared/schema";
import { db } from "../../db";
import { ForbiddenError } from "../../core/errors";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { visibleInvestmentTransactionPredicate } from "../../core/authz/investment-visibility";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { ListTaxLotsQuery } from "./investments.validation";

/** An authorized source list, never a claim that unsupported legacy basis is a
 * complete portfolio. Its remaining quantity also depends on every disposal;
 * omitting only a private nested disposal would still expose its derived state. */
export function listVisibleInvestmentTaxLots(caller: HouseholdContext, filters: ListTaxLotsQuery) {
  if (!caller?.householdId || !caller.userId) throw new ForbiddenError("Financial read access required");
  return db.transaction(async tx => {
    const [grant] = await tx.select({ role: householdMembers.role }).from(householdMembers).innerJoin(users, eq(users.id, householdMembers.userId)).where(and(
      eq(householdMembers.householdId, caller.householdId), eq(householdMembers.userId, caller.userId), isNull(users.erasedAt), eq(users.emailVerified, true),
    ));
    if (!grant || !can(grant.role, "financial.read")) throw new ForbiddenError("Financial read access required");
    const actor = { ...caller, role: grant.role };
    const visibleActivity = visibleInvestmentTransactionPredicate(actor);
    const acquisition = sql`exists(select 1 from ${investmentTransactions} where ${visibleActivity}
      and ${investmentTransactions.id}=${taxLots.transactionId}
      and (${investmentTransactions.holdingId} is null or ${investmentTransactions.holdingId}=${taxLots.holdingId})
      and (${investmentTransactions.securityId} is null or ${investmentTransactions.securityId}=${holdings.securityId}))`;
    const closing = sql`exists(select 1 from ${investmentTransactions} where ${visibleActivity}
      and ${investmentTransactions.id}=${taxLotDisposals.transactionId}
      and (${investmentTransactions.holdingId} is null or ${investmentTransactions.holdingId}=${taxLots.holdingId})
      and (${investmentTransactions.securityId} is null or ${investmentTransactions.securityId}=${holdings.securityId}))`;
    const lots = await tx.select({ lot: taxLots, holding: holdings, security: securities }).from(taxLots)
      .innerJoin(holdings, eq(holdings.id, taxLots.holdingId)).innerJoin(securities, eq(securities.id, holdings.securityId))
      .where(and(
        eq(taxLots.householdId, actor.householdId), eq(holdings.householdId, actor.householdId),
        sql`exists(select 1 from ${accounts} where ${accounts.id}=${holdings.accountId} and ${visibleAccountPredicate(actor)})`,
        acquisition,
        sql`not exists(select 1 from ${taxLotDisposals} where ${taxLotDisposals.taxLotId}=${taxLots.id}
          and not (${taxLotDisposals.householdId}=${actor.householdId}::uuid and ${taxLotDisposals.holdingId}=${taxLots.holdingId} and ${closing}))`,
        // A removed closing activity cascades its disposal but does not restore
        // remaining_quantity. That orphaned derived state cannot prove a source.
        sql`${taxLots.remainingQuantity}=${taxLots.quantity}-coalesce((select sum(${taxLotDisposals.quantity}) from ${taxLotDisposals}
          where ${taxLotDisposals.taxLotId}=${taxLots.id}),0)`,
        filters.holdingId ? eq(taxLots.holdingId, filters.holdingId) : undefined,
      )).orderBy(asc(taxLots.acquiredDate), asc(taxLots.createdAt), asc(taxLots.id)).limit(filters.limit);
    if (!filters.includeDisposals || !lots.length) return lots.map(({ lot, holding, security }) => ({ ...lot, holding, security }));
    // The same snapshot fixes grant, sources and all derived inputs while the
    // batch is loaded; a concurrent withdrawal cannot produce a mixed audience.
    const disposals = await tx.select().from(taxLotDisposals).where(and(
      inArray(taxLotDisposals.taxLotId, lots.map(row => row.lot.id)), eq(taxLotDisposals.householdId, actor.householdId),
    )).orderBy(desc(taxLotDisposals.disposedDate), asc(taxLotDisposals.id));
    const grouped = new Map<string, TaxLotDisposal[]>();
    for (const disposal of disposals) {
      const values = grouped.get(disposal.taxLotId) ?? [];
      values.push(disposal); grouped.set(disposal.taxLotId, values);
    }
    return lots.map(({ lot, holding, security }) => ({ ...lot, holding, security, disposals: grouped.get(lot.id) ?? [] }));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
