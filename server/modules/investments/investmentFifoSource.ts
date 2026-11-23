import Decimal from "decimal.js";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { accounts, holdings, investmentTransactions, securities, taxLotDisposals, taxLots, transactions,
  type Account, type Holding, type InvestmentTransaction, type Security, type TaxLot, type TaxLotDisposal, type Transaction } from "@shared/schema";
import { can } from "../../core/authz/capabilities";
import { ConflictError } from "../../core/errors";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { TransactionType } from "../../utils/withTransaction";

const Exact = Decimal.clone({ precision: 48 });
const unavailable = () => new ConflictError("Investment sale sources are unavailable");
const ids = (values: Array<string | null>) => Array.from(new Set(values.filter((value): value is string => value !== null))).sort();
function number(value: string | null, positive = false) {
  try {
    const result = new Exact(value ?? "NaN");
    if (!result.isFinite() || (positive ? result.lte(0) : result.lt(0))) throw unavailable();
    return result;
  } catch { throw unavailable(); }
}
function optionalEqual(left: string | null, right: string | null) {
  return left === null || right === null ? left === right : number(left).eq(number(right));
}
function lockFailure(error: unknown): boolean {
  let cause = error;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
    const row = cause as { code?: unknown; cause?: unknown };
    if (row.code === "55P03" || row.code === "40P01" || row.code === "40001") return true;
    cause = row.cause;
  }
  return false;
}

export interface AuthorizedFifoLot {
  lot: TaxLot; sold: string; basisUsed: string; baseUsed: string; baseComplete: boolean; sameSource: boolean;
}
interface Sources {
  lots: TaxLot[]; disposals: TaxLotDisposal[]; activity: InvestmentTransaction[]; cash: Transaction[]; accounts: Account[];
  purchaseClaims: Array<Pick<TaxLot, "id" | "transactionId">>;
  closingAllocations: Array<Pick<TaxLotDisposal, "id" | "householdId" | "holdingId" | "taxLotId" | "transactionId" | "quantity" | "proceeds" | "disposedDate">>;
  closingLots: Array<Pick<TaxLot, "id" | "householdId" | "holdingId" | "acquiredDate">>;
  holding: Holding | undefined; security: Security | undefined;
}
async function readSources(tx: TransactionType, lotIds: string[], sale: InvestmentTransaction): Promise<Sources> {
  const lots = await tx.select().from(taxLots).where(inArray(taxLots.id, lotIds)).orderBy(taxLots.id);
  const disposals = await tx.select().from(taxLotDisposals).where(inArray(taxLotDisposals.taxLotId, lotIds)).orderBy(taxLotDisposals.id);
  const purchaseIds = ids(lots.map(lot => lot.transactionId));
  const purchaseClaims = purchaseIds.length ? await tx.select({ id: taxLots.id, transactionId: taxLots.transactionId }).from(taxLots)
    .where(inArray(taxLots.transactionId, purchaseIds)).orderBy(taxLots.id) : [];
  const closingIds = ids(disposals.map(row => row.transactionId));
  // The full parent sale must substantiate all allocations, even an exhausted
  // sibling outside today's prefix. Its private basis figures are not needed.
  const closingAllocations = closingIds.length ? await tx.select({ id: taxLotDisposals.id, householdId: taxLotDisposals.householdId,
    holdingId: taxLotDisposals.holdingId, taxLotId: taxLotDisposals.taxLotId, transactionId: taxLotDisposals.transactionId,
    quantity: taxLotDisposals.quantity, proceeds: taxLotDisposals.proceeds, disposedDate: taxLotDisposals.disposedDate }).from(taxLotDisposals)
    .where(inArray(taxLotDisposals.transactionId, closingIds)).orderBy(taxLotDisposals.id) : [];
  const closingLotIds = ids(closingAllocations.map(row => row.taxLotId));
  const closingLots = closingLotIds.length ? await tx.select({ id: taxLots.id, householdId: taxLots.householdId, holdingId: taxLots.holdingId, acquiredDate: taxLots.acquiredDate })
    .from(taxLots).where(inArray(taxLots.id, closingLotIds)).orderBy(taxLots.id) : [];
  const activityIds = ids([...lots.map(lot => lot.transactionId), ...disposals.map(row => row.transactionId)]);
  const activity = activityIds.length ? await tx.select().from(investmentTransactions).where(inArray(investmentTransactions.id, activityIds)).orderBy(investmentTransactions.id) : [];
  const cashIds = ids(activity.map(row => row.linkedTransactionId));
  const cash = cashIds.length ? await tx.select().from(transactions).where(inArray(transactions.id, cashIds)).orderBy(transactions.id) : [];
  const accountIds = ids([sale.accountId, ...activity.map(row => row.accountId), ...cash.map(row => row.accountId)]);
  const scopedAccounts = await tx.select().from(accounts).where(inArray(accounts.id, accountIds)).orderBy(accounts.id);
  const [holding] = sale.holdingId ? await tx.select().from(holdings).where(eq(holdings.id, sale.holdingId)) : [];
  const [security] = sale.securityId ? await tx.select().from(securities).where(eq(securities.id, sale.securityId)) : [];
  return { lots, disposals, purchaseClaims, closingAllocations, closingLots, activity, cash, accounts: scopedAccounts, holding, security };
}

function authorize(frame: Sources, actor: HouseholdContext, sale: InvestmentTransaction): AuthorizedFifoLot[] {
  const accountById = new Map(frame.accounts.map(row => [row.id, row]));
  const activityById = new Map(frame.activity.map(row => [row.id, row]));
  const cashById = new Map(frame.cash.map(row => [row.id, row]));
  const closingLotById = new Map(frame.closingLots.map(row => [row.id, row]));
  function visibleAccount(id: string) {
    const account = accountById.get(id);
    return account && account.householdId === actor.householdId && !account.deletedAt &&
      (account.isPrivate === false || account.ownerUserId === actor.userId);
  }
  function visibleActivity(row: InvestmentTransaction | undefined, type: "buy" | "sell") {
    if (!row || row.type !== type || row.householdId !== actor.householdId || row.holdingId !== sale.holdingId ||
      row.securityId !== sale.securityId || row.currency !== sale.currency || !visibleAccount(row.accountId)) throw unavailable();
    if (row.linkedTransactionId) {
      const receipt = cashById.get(row.linkedTransactionId);
      if (!receipt || receipt.householdId !== actor.householdId || receipt.deletedAt ||
        (receipt.isPrivate !== false && receipt.ownerUserId !== actor.userId) || !visibleAccount(receipt.accountId) || receipt.currency !== row.currency) throw unavailable();
    }
    return row;
  }
  if (!frame.holding || frame.holding.householdId !== actor.householdId || frame.holding.id !== sale.holdingId ||
    frame.holding.accountId !== sale.accountId || frame.holding.securityId !== sale.securityId || !visibleAccount(frame.holding.accountId) ||
    !frame.security || frame.security.id !== sale.securityId || frame.security.currency !== sale.currency) throw unavailable();
  for (const closingId of ids(frame.disposals.map(row => row.transactionId))) {
    const closing = visibleActivity(activityById.get(closingId), "sell");
    let quantity = new Exact(0), proceeds = new Exact(0);
    for (const allocation of frame.closingAllocations.filter(row => row.transactionId === closingId)) {
      const linkedLot = closingLotById.get(allocation.taxLotId);
      if (!linkedLot || linkedLot.householdId !== actor.householdId || linkedLot.holdingId !== sale.holdingId ||
        allocation.householdId !== actor.householdId || allocation.holdingId !== sale.holdingId || allocation.disposedDate !== closing.transactionDate ||
        allocation.disposedDate < linkedLot.acquiredDate || allocation.disposedDate > sale.transactionDate) throw unavailable();
      quantity = quantity.plus(number(allocation.quantity, true)); proceeds = proceeds.plus(number(allocation.proceeds));
    }
    if (!quantity.eq(number(closing.quantity, true)) || !proceeds.eq(number(closing.amount))) throw unavailable();
  }
  return frame.lots.map(lot => {
    const purchase = visibleActivity(lot.transactionId ? activityById.get(lot.transactionId) : undefined, "buy");
    const claims = frame.purchaseClaims.filter(row => row.transactionId === purchase.id);
    if (claims.length !== 1 || claims[0].id !== lot.id) throw unavailable();
    if (lot.householdId !== actor.householdId || lot.holdingId !== sale.holdingId || lot.acquiredDate !== purchase.transactionDate ||
      lot.acquiredDate > sale.transactionDate || !number(lot.quantity, true).eq(number(purchase.quantity, true)) ||
      !number(lot.costBasis).eq(number(purchase.amount)) || !optionalEqual(lot.costBasisZmw, purchase.amountZmw) ||
      !optionalEqual(lot.acquisitionFxRate, purchase.fxRate)) throw unavailable();
    let sold = new Exact(0), basisUsed = new Exact(0), baseUsed = new Exact(0), baseComplete = true;
    for (const disposal of frame.disposals.filter(row => row.taxLotId === lot.id)) {
      const closing = visibleActivity(activityById.get(disposal.transactionId), "sell");
      if (disposal.householdId !== actor.householdId || disposal.holdingId !== sale.holdingId || disposal.disposedDate !== closing.transactionDate ||
        disposal.disposedDate < lot.acquiredDate || disposal.disposedDate > sale.transactionDate) throw unavailable();
      const quantity = number(disposal.quantity, true), basis = number(disposal.costBasis), proceeds = number(disposal.proceeds);
      if (quantity.gt(number(closing.quantity, true)) || proceeds.gt(number(closing.amount)) ||
        !new Exact(disposal.realizedGain).isFinite() || !new Exact(disposal.realizedGain).eq(proceeds.minus(basis))) throw unavailable();
      sold = sold.plus(quantity); basisUsed = basisUsed.plus(basis);
      if (disposal.costBasisZmw === null) baseComplete = false;
      else baseUsed = baseUsed.plus(number(disposal.costBasisZmw));
    }
    if (!number(lot.remainingQuantity, true).plus(sold).eq(number(lot.quantity, true)) || basisUsed.gt(number(lot.costBasis)) ||
      (lot.costBasisZmw !== null && baseUsed.gt(number(lot.costBasisZmw)))) throw unavailable();
    return { lot, sold: sold.toFixed(8), basisUsed: basisUsed.toFixed(2), baseUsed: baseUsed.toFixed(2), baseComplete, sameSource: true };
  });
}

/** The caller holds its live grant/identity, holding UPDATE and current account
 * and instrument locks. Selection/range chronology remains that writer's job.
 * Reject a required inaccessible lot; never filter it out to use a later one. */
export async function lockInvestmentFifoSources(tx: TransactionType, actor: HouseholdContext, sale: InvestmentTransaction): Promise<AuthorizedFifoLot[]> {
  if (!actor?.userId || actor.householdId !== sale.householdId || !can(actor.role, "financial.write") || !sale.holdingId || !sale.quantity) throw unavailable();
  try {
    const candidates = await tx.select().from(taxLots).where(and(eq(taxLots.holdingId, sale.holdingId),
      lte(taxLots.acquiredDate, sale.transactionDate), gt(taxLots.remainingQuantity, "0"))).orderBy(asc(taxLots.acquiredDate), asc(taxLots.createdAt), asc(taxLots.id));
    let needed = number(sale.quantity, true);
    const prefix: TaxLot[] = [];
    for (const lot of candidates) {
      prefix.push(lot); needed = needed.minus(number(lot.remainingQuantity, true));
      if (needed.lte(0)) break;
    }
    if (!prefix.length || needed.gt(0)) throw unavailable();
    const lotIds = ids(prefix.map(lot => lot.id));
    const before = await readSources(tx, lotIds, sale);
    if (!isDeepStrictEqual([...prefix].sort((left, right) => left.id.localeCompare(right.id)), before.lots)) throw unavailable();
    authorize(before, actor, sale);
    // Provisional authorization precedes any cross-source locks. NOWAIT
    // prevents account -> cash inversion with the ordinary cash edit writer.
    await tx.select({ id: taxLots.id }).from(taxLots).where(inArray(taxLots.id, lotIds)).orderBy(taxLots.id).for("update", { noWait: true });
    const closingLotIds = ids(before.closingLots.map(row => row.id));
    if (closingLotIds.length) await tx.select({ id: taxLots.id }).from(taxLots).where(inArray(taxLots.id, closingLotIds)).orderBy(taxLots.id).for("share", { noWait: true });
    const disposalIds = ids(before.closingAllocations.map(row => row.id));
    if (disposalIds.length) await tx.select({ id: taxLotDisposals.id }).from(taxLotDisposals).where(inArray(taxLotDisposals.id, disposalIds)).orderBy(taxLotDisposals.id).for("share", { noWait: true });
    const activityIds = ids(before.activity.map(row => row.id));
    // UPDATE conflicts with FK KEY SHARE on new tax-lot claimants and new
    // allocations. Existing-row SHARE alone cannot fence those phantoms.
    await tx.select({ id: investmentTransactions.id }).from(investmentTransactions).where(inArray(investmentTransactions.id, activityIds)).orderBy(investmentTransactions.id).for("update", { noWait: true });
    const cashIds = ids(before.cash.map(row => row.id));
    if (cashIds.length) await tx.select({ id: transactions.id }).from(transactions).where(inArray(transactions.id, cashIds)).orderBy(transactions.id).for("share", { noWait: true });
    await tx.select({ id: accounts.id }).from(accounts).where(inArray(accounts.id, ids(before.accounts.map(row => row.id)))).orderBy(accounts.id).for("share", { noWait: true });
    const after = await readSources(tx, lotIds, sale);
    if (!isDeepStrictEqual(before, after)) throw unavailable();
    const authorized = new Map(authorize(after, actor, sale).map(row => [row.lot.id, row]));
    return prefix.map(lot => authorized.get(lot.id)!);
  } catch (error) {
    if (lockFailure(error)) throw unavailable();
    throw error;
  }
}
