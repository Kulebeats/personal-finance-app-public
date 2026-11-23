import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, or } from "drizzle-orm";
import { accounts, auditLogs, investmentTransactions, taxLotDisposals, taxLots, transactions, type Holding } from "@shared/schema";
import type { TransactionType } from "../../utils/withTransaction";
import { calculateHoldingRemainingBasis, holdingBasisUnavailable, type HoldingBasisFrame } from "./investmentHoldingBasis";
import { visibleInvestmentTransactionPredicate } from "../../core/authz/investment-visibility";
import { NotFoundError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { Money } from "../../core/money";

const ids = (values: Array<string | null>) => Array.from(new Set(values.filter((value): value is string => value !== null))).sort();
async function read(tx: TransactionType, holding: Holding, currency: string): Promise<HoldingBasisFrame> {
  const lots = await tx.select().from(taxLots).where(eq(taxLots.holdingId, holding.id)).orderBy(taxLots.id);
  const lotIds = ids(lots.map(row => row.id));
  const linkedDisposals = await tx.select().from(taxLotDisposals).where(or(
    eq(taxLotDisposals.holdingId, holding.id), inArray(taxLotDisposals.taxLotId, lotIds),
  )).orderBy(taxLotDisposals.id);
  const activity = await tx.select().from(investmentTransactions).where(or(
    and(eq(investmentTransactions.holdingId, holding.id), inArray(investmentTransactions.type, ["buy", "sell"])),
    inArray(investmentTransactions.id, ids([...lots.map(row => row.transactionId), ...linkedDisposals.map(row => row.transactionId)])),
  )).orderBy(investmentTransactions.id);
  const closingIds = ids([...activity.filter(row => row.type === "sell").map(row => row.id), ...linkedDisposals.map(row => row.transactionId)]);
  // Include every allocation claimed by a parent sale, including a duplicate
  // or an exhausted/foreign sibling outside the currently remaining position.
  const disposals = await tx.select().from(taxLotDisposals).where(or(
    eq(taxLotDisposals.holdingId, holding.id), inArray(taxLotDisposals.taxLotId, lotIds), inArray(taxLotDisposals.transactionId, closingIds),
  )).orderBy(taxLotDisposals.id);
  const purchaseIds = ids(activity.filter(row => row.type === "buy").map(row => row.id));
  const claims = await tx.select({ id: taxLots.id, transactionId: taxLots.transactionId }).from(taxLots)
    .where(inArray(taxLots.transactionId, purchaseIds)).orderBy(taxLots.id);
  const cash = await tx.select().from(transactions).where(inArray(transactions.id, ids(activity.map(row => row.linkedTransactionId)))).orderBy(transactions.id);
  const sourceAccounts = await tx.select().from(accounts).where(inArray(accounts.id,
    ids([holding.accountId, ...activity.map(row => row.accountId), ...cash.map(row => row.accountId)]))).orderBy(accounts.id);
  return { holding, currency, lots, activity, disposals, claims, accounts: sourceAccounts, cash };
}
function concurrencyFailure(error: unknown) {
  let cause = error;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
    const row = cause as { code?: unknown; cause?: unknown };
    if (row.code === "55P03" || row.code === "40P01" || row.code === "40001") return true;
    cause = row.cause;
  }
  return false;
}

/** The manual writer already holds live grant, holding UPDATE, custody-account
 * and instrument SHARE locks. This internal result conveys no source read
 * permission. NOWAIT avoids inversion with independent account/cash editors. */
export async function lockHoldingRemainingBasis(tx: TransactionType, holding: Holding, currency: string) {
  try {
    const before = await read(tx, holding, currency);
    calculateHoldingRemainingBasis(before);
    const lotIds = ids([...before.lots.map(row => row.id), ...before.claims.map(row => row.id)]);
    if (lotIds.length) await tx.select({ id: taxLots.id }).from(taxLots).where(inArray(taxLots.id, lotIds)).orderBy(taxLots.id).for("update", { noWait: true });
    const disposalIds = ids(before.disposals.map(row => row.id));
    if (disposalIds.length) await tx.select({ id: taxLotDisposals.id }).from(taxLotDisposals).where(inArray(taxLotDisposals.id, disposalIds)).orderBy(taxLotDisposals.id).for("share", { noWait: true });
    const activityIds = ids(before.activity.map(row => row.id));
    // UPDATE also fences new lot/disposal FK claims on these parent trades.
    if (activityIds.length) await tx.select({ id: investmentTransactions.id }).from(investmentTransactions).where(inArray(investmentTransactions.id, activityIds)).orderBy(investmentTransactions.id).for("update", { noWait: true });
    const cashIds = ids(before.cash.map(row => row.id));
    if (cashIds.length) await tx.select({ id: transactions.id }).from(transactions).where(inArray(transactions.id, cashIds)).orderBy(transactions.id).for("share", { noWait: true });
    const accountIds = ids(before.accounts.map(row => row.id));
    if (accountIds.length) await tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, accountIds)).orderBy(accounts.id).for("share", { noWait: true });
    const after = await read(tx, holding, currency);
    if (!isDeepStrictEqual(before, after)) throw holdingBasisUnavailable();
    return calculateHoldingRemainingBasis(after);
  } catch (error) {
    if (concurrencyFailure(error)) throw holdingBasisUnavailable();
    throw error;
  }
}

/** Returning an aggregate or comparing a guessed cost is a source read. This
 * stricter boundary is separate from internal write-only basis maintenance. */
export async function lockHoldingBasisDisclosure(tx: TransactionType, holding: Holding, currency: string, actor: HouseholdContext) {
  const basis = await lockHoldingRemainingBasis(tx, holding, currency);
  const frame = await read(tx, holding, currency);
  const activityIds = ids(frame.activity.map(row => row.id));
  if (activityIds.length) {
    const visible = await tx.select({ id: investmentTransactions.id }).from(investmentTransactions)
      .where(and(inArray(investmentTransactions.id, activityIds), visibleInvestmentTransactionPredicate(actor)));
    if (visible.length !== activityIds.length) throw new NotFoundError("Holding");
  }
  const origins = await (async () => {
    try {
      return await tx.select({ details: auditLogs.details, householdId: auditLogs.householdId, userId: auditLogs.userId }).from(auditLogs).where(and(
        eq(auditLogs.entityId, holding.id), eq(auditLogs.entityType, "holding"), eq(auditLogs.action, "CREATE"),
      )).for("share", { noWait: true });
    } catch (error) {
      if (concurrencyFailure(error)) throw holdingBasisUnavailable();
      throw error;
    }
  })();
  // A supported source is not permission to publish a stale aggregate. Keep
  // empty nullable shells distinct, and validate original declared FX against
  // its actual dated acquisition rather than an aggregate's null rate.
  try {
    const equal = (left: string | null, right: string | null) => left === null || right === null ? left === right :
      new Money(left).amount.isFinite() && new Money(right).amount.isFinite() && new Money(left).equals(right);
    const shell = frame.lots.length === 0 && new Money(holding.quantity).isZero();
    if (!(shell && holding.costBasis === null) && !equal(holding.costBasis, basis.costBasis)) throw holdingBasisUnavailable();
    if (!(shell && holding.costBasisZmw === null) && !equal(holding.costBasisZmw, basis.costBasisZmw)) throw holdingBasisUnavailable();
    const details = origins.length === 1 ? origins[0].details as Record<string, unknown> : null;
    const origin = details?.newValue as Record<string, unknown> | undefined;
    // Keep the genuine actor-scoped emitter. An erased identity tombstone may
    // retain its historical user ID; a detached/system actor is unknown, and
    // a household-audience marker cannot certify this declaration.
    const declared = origins.length === 1 && origins[0].householdId === null && origins[0].userId !== null
      && details?.openingBasis === "declared_record_only_v1" && origin?.accountId === holding.accountId
      && origin?.securityId === holding.securityId && origin?.currency === currency;
    // Old audits omitted these fields. Only explicit unknown values can be
    // disclosed without a supported original declaration; never borrow a later
    // lot date/rate to certify a changed original field or a zero-share shell.
    if (holding.acquiredDate !== null && (!declared || origin?.acquiredDate !== holding.acquiredDate)) throw holdingBasisUnavailable();
    if (holding.acquisitionFxRate !== null && (!declared || typeof origin?.acquisitionFxRate !== "string" || !equal(origin.acquisitionFxRate, holding.acquisitionFxRate))) throw holdingBasisUnavailable();
  } catch { throw holdingBasisUnavailable(); }
}
