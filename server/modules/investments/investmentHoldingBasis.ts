import type { Account, Holding, InvestmentTransaction, TaxLot, TaxLotDisposal, Transaction } from "@shared/schema";
import Decimal from "decimal.js";
import { Money } from "../../core/money";
import { ConflictError } from "../../core/errors";

export interface HoldingBasisFrame {
  holding: Pick<Holding, "id" | "householdId" | "accountId" | "securityId" | "quantity" | "costBasis" | "costBasisZmw">;
  currency: string;
  lots: Array<Pick<TaxLot, "id" | "householdId" | "holdingId" | "transactionId" | "quantity" | "remainingQuantity" | "costBasis" | "costBasisZmw" | "acquisitionFxRate" | "acquiredDate">>;
  activity: Array<Pick<InvestmentTransaction, "id" | "householdId" | "accountId" | "holdingId" | "securityId" | "type" | "quantity" | "amount" | "currency" | "amountZmw" | "fxRate" | "linkedTransactionId" | "transactionDate">>;
  disposals: Array<Pick<TaxLotDisposal, "id" | "householdId" | "holdingId" | "taxLotId" | "transactionId" | "quantity" | "costBasis" | "costBasisZmw" | "proceeds" | "proceedsZmw" | "realizedGain" | "realizedGainZmw" | "disposedDate">>;
  claims: Array<Pick<TaxLot, "id" | "transactionId">>;
  accounts: Array<Pick<Account, "id" | "householdId" | "deletedAt">>;
  cash: Array<Pick<Transaction, "id" | "householdId" | "accountId" | "currency" | "deletedAt">>;
}

const Exact = Decimal.clone({ precision: 48 });
/** Stored rates carry up to 8 places (0041). */
const RATE_PLACES = 8;
export const holdingBasisUnavailable = () => new ConflictError("Investment sale sources are unavailable");
function decimal(value: string | null, scale: number, positive = false) {
  try {
    const result = new Exact(value ?? "NaN");
    if (!result.isFinite() || result.decimalPlaces() > scale || (positive ? result.lte(0) : result.lt(0))) throw holdingBasisUnavailable();
    return result;
  } catch { throw holdingBasisUnavailable(); }
}
function money(value: string | null, currency: string) {
  const amount = decimal(value, 2);
  if (amount.gt("9999999999999.99")) throw holdingBasisUnavailable();
  return new Money(amount.toFixed(2), currency);
}
function optionalEqual(left: string | null, right: string | null) {
  return left === null || right === null ? left === right : decimal(left, RATE_PLACES).eq(decimal(right, RATE_PLACES));
}

/** Internal write-only reconciliation. Source privacy still belongs to FIFO
 * authorization and every aggregate reader; this result must not enter the
 * trade response or its shared audit. An aggregate alone proves no opening. */
export function calculateHoldingRemainingBasis(frame: HoldingBasisFrame) {
  const { holding, currency, lots, activity, disposals } = frame;
  if (!/^[A-Z]{3}$/.test(currency)) throw holdingBasisUnavailable();
  const accountById = new Map(frame.accounts.map(row => [row.id, row]));
  const cashById = new Map(frame.cash.map(row => [row.id, row]));
  const lotById = new Map(lots.map(row => [row.id, row]));
  const activityById = new Map(activity.map(row => [row.id, row]));
  function account(id: string) {
    const row = accountById.get(id);
    if (!row || row.householdId !== holding.householdId || row.deletedAt) throw holdingBasisUnavailable();
  }
  account(holding.accountId);
  for (const row of activity) {
    account(row.accountId);
    if ((row.type !== "buy" && row.type !== "sell") || row.householdId !== holding.householdId || row.holdingId !== holding.id ||
      row.securityId !== holding.securityId || row.currency !== currency) throw holdingBasisUnavailable();
    decimal(row.quantity, 8, true); money(row.amount, currency);
    if (row.amountZmw !== null) money(row.amountZmw, "ZMW");
    if (row.fxRate !== null) decimal(row.fxRate, RATE_PLACES, true);
    if (row.amountZmw !== null) {
      const native = decimal(row.amount, 2), base = decimal(row.amountZmw, 2);
      if ((native.isZero() && !base.isZero()) || (row.fxRate !== null &&
        !native.times(decimal(row.fxRate, RATE_PLACES, true)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).eq(base))) throw holdingBasisUnavailable();
    }
    if (currency === "ZMW" && ((row.amountZmw !== null && !money(row.amount, currency).equals(row.amountZmw)) ||
      (row.fxRate !== null && !decimal(row.fxRate, RATE_PLACES, true).eq(1)))) throw holdingBasisUnavailable();
    if (row.linkedTransactionId) {
      const receipt = cashById.get(row.linkedTransactionId);
      if (!receipt || receipt.householdId !== holding.householdId || receipt.deletedAt || receipt.currency !== currency) throw holdingBasisUnavailable();
      account(receipt.accountId);
    }
    if (row.type === "buy") {
      const claims = frame.claims.filter(lot => lot.transactionId === row.id);
      if (claims.length !== 1 || !lotById.has(claims[0].id)) throw holdingBasisUnavailable();
    } else {
      let quantity = new Exact(0), proceeds = Money.zero(currency), baseProceeds = Money.zero("ZMW");
      const allocations = disposals.filter(disposal => disposal.transactionId === row.id);
      for (const disposal of allocations) {
        quantity = quantity.plus(decimal(disposal.quantity, 8, true));
        proceeds = proceeds.add(money(disposal.proceeds, currency));
        if (row.amountZmw !== null) baseProceeds = baseProceeds.add(money(disposal.proceedsZmw, "ZMW"));
        else if (disposal.proceedsZmw !== null) throw holdingBasisUnavailable();
      }
      if (!quantity.eq(row.quantity!) || !proceeds.equals(row.amount) ||
        (row.amountZmw !== null && !baseProceeds.equals(row.amountZmw))) throw holdingBasisUnavailable();
    }
  }
  for (const disposal of disposals) {
    const lot = lotById.get(disposal.taxLotId), closing = activityById.get(disposal.transactionId);
    if (!lot || !closing || closing.type !== "sell" || disposal.householdId !== holding.householdId || disposal.holdingId !== holding.id ||
      disposal.disposedDate !== closing.transactionDate || disposal.disposedDate < lot.acquiredDate) throw holdingBasisUnavailable();
    const basis = money(disposal.costBasis, currency), proceeds = money(disposal.proceeds, currency);
    try {
      if (!proceeds.subtract(basis).equals(disposal.realizedGain)) throw holdingBasisUnavailable();
    } catch { throw holdingBasisUnavailable(); }
    if (disposal.costBasisZmw !== null) {
      money(disposal.costBasisZmw, "ZMW");
      if (lot.costBasisZmw === null || (currency === "ZMW" && !basis.equals(disposal.costBasisZmw))) throw holdingBasisUnavailable();
    }
    if (disposal.proceedsZmw !== null && disposal.costBasisZmw !== null) {
      if (disposal.realizedGainZmw === null || !money(disposal.proceedsZmw, "ZMW").subtract(money(disposal.costBasisZmw, "ZMW")).equals(disposal.realizedGainZmw)) throw holdingBasisUnavailable();
    } else if (disposal.realizedGainZmw !== null) throw holdingBasisUnavailable();
  }
  let quantity = new Exact(0), cost = Money.zero(currency), base = Money.zero("ZMW"), baseKnown = true;
  for (const lot of lots) {
    const purchase = lot.transactionId ? activityById.get(lot.transactionId) : undefined;
    if (!purchase || purchase.type !== "buy" || lot.householdId !== holding.householdId || lot.holdingId !== holding.id ||
      lot.acquiredDate !== purchase.transactionDate || !decimal(lot.quantity, 8, true).eq(purchase.quantity!) ||
      !money(lot.costBasis, currency).equals(purchase.amount) || !optionalEqual(lot.costBasisZmw, purchase.amountZmw) ||
      !optionalEqual(lot.acquisitionFxRate, purchase.fxRate)) throw holdingBasisUnavailable();
    let sold = new Exact(0), used = Money.zero(currency), baseUsed = Money.zero("ZMW"), baseComplete = true;
    for (const disposal of disposals.filter(row => row.taxLotId === lot.id)) {
      sold = sold.plus(decimal(disposal.quantity, 8, true)); used = used.add(money(disposal.costBasis, currency));
      if (disposal.costBasisZmw === null) baseComplete = false;
      else baseUsed = baseUsed.add(money(disposal.costBasisZmw, "ZMW"));
    }
    const remaining = decimal(lot.remainingQuantity, 8), residual = money(lot.costBasis, currency).subtract(used);
    const baseResidual = lot.costBasisZmw === null || !baseComplete ? null : money(lot.costBasisZmw, "ZMW").subtract(baseUsed);
    if (!remaining.plus(sold).eq(lot.quantity) || residual.isNegative() || baseResidual?.isNegative() ||
      (remaining.isZero() && (!residual.isZero() || (baseResidual !== null && !baseResidual.isZero())))) throw holdingBasisUnavailable();
    quantity = quantity.plus(remaining); cost = cost.add(residual);
    if (!remaining.isZero()) {
      if (baseResidual === null) baseKnown = false;
      else base = base.add(baseResidual);
    }
  }
  if (!quantity.eq(decimal(holding.quantity, 8)) || quantity.gte("1e10") ||
    (lots.length === 0 && holding.costBasis !== null && !money(holding.costBasis, currency).isZero())) throw holdingBasisUnavailable();
  // Refuse storage overflow before PostgreSQL can emit source-bearing errors.
  money(cost.toString(), currency);
  if (baseKnown) money(base.toString(), "ZMW");
  return { quantity: quantity.toFixed(8), costBasis: cost.toString(),
    costBasisZmw: currency === "ZMW" ? cost.toString() : baseKnown ? base.toString() : null, acquisitionFxRate: null };
}
