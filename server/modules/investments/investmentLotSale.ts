import Decimal from "decimal.js";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { lockInvestmentFifoSources } from "./investmentFifoSource";
import { eq } from "drizzle-orm";
import { taxLotDisposals, taxLots, type InvestmentTransaction } from "@shared/schema";
import { ConflictError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";

// The product of a NUMERIC(15,2) amount and a NUMERIC(18,8) share count
// must retain precision until the allocation is rounded to a currency cent.
const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
function allocate(remaining: Decimal, shares: Decimal, remainingShares: Decimal) {
  return shares.eq(remainingShares) ? remaining : remaining.times(shares).div(remainingShares).toDecimalPlaces(2);
}

export async function postInvestmentLotSale(tx: TransactionType, sale: InvestmentTransaction, actor: HouseholdContext) {
  if (!sale.holdingId || !sale.quantity) throw new ConflictError("Sale is missing its holding or quantity");
  const lots = await lockInvestmentFifoSources(tx, actor, sale);

  let sharesLeft = new Exact(sale.quantity);
  let proceedsLeft = new Exact(sale.amount);
  let baseProceedsLeft = sale.amountZmw === null ? null : new Exact(sale.amountZmw);
  for (const { lot, sold, basisUsed, baseUsed, baseComplete, sameSource } of lots) {
    const lotShares = new Exact(lot.remainingQuantity);
    const basisLeft = new Exact(lot.costBasis).minus(basisUsed);
    const baseBasisLeft = lot.costBasisZmw === null || !baseComplete ? null : new Exact(lot.costBasisZmw).minus(baseUsed);
    if (!sameSource || !lotShares.plus(sold).eq(lot.quantity) || basisLeft.isNegative() || baseBasisLeft?.isNegative()) {
      throw new ConflictError("Stored tax lot history does not reconcile to its remaining basis and quantity");
    }
    const shares = Exact.min(sharesLeft, lotShares);
    const proceeds = allocate(proceedsLeft, shares, sharesLeft);
    const basis = allocate(basisLeft, shares, lotShares);
    const baseProceeds: Decimal | null = baseProceedsLeft && allocate(baseProceedsLeft, shares, sharesLeft);
    const baseBasis = baseBasisLeft && allocate(baseBasisLeft, shares, lotShares);
    await tx.insert(taxLotDisposals).values({
      householdId: sale.householdId, holdingId: sale.holdingId, taxLotId: lot.id, transactionId: sale.id,
      quantity: shares.toFixed(8), disposedDate: sale.transactionDate,
      proceeds: proceeds.toFixed(2), costBasis: basis.toFixed(2), realizedGain: proceeds.minus(basis).toFixed(2),
      proceedsZmw: baseProceeds?.toFixed(2) ?? null, costBasisZmw: baseBasis?.toFixed(2) ?? null,
      realizedGainZmw: baseProceeds && baseBasis ? baseProceeds.minus(baseBasis).toFixed(2) : null,
    });
    await tx.update(taxLots).set({ remainingQuantity: lotShares.minus(shares).toFixed(8), updatedAt: new Date() })
      .where(eq(taxLots.id, lot.id));
    sharesLeft = sharesLeft.minus(shares);
    if (sharesLeft.isZero()) return;
    proceedsLeft = proceedsLeft.minus(proceeds);
    if (baseProceedsLeft && baseProceeds) baseProceedsLeft = baseProceedsLeft.minus(baseProceeds);
  }
  throw new ConflictError("Insufficient tax lot quantity on the sale date");
}
