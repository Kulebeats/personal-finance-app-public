import { sql } from "drizzle-orm";
import { investmentTransactions, taxLotDisposals, taxLots, type InvestmentTransaction } from "@shared/schema";
import { ConflictError } from "../../core/errors";
import type { TransactionType } from "../../utils/withTransaction";
type DatedTrade = Pick<InvestmentTransaction, "type" | "transactionDate"> & { holdingId?: string | null };

/** The caller holds the holding row FOR UPDATE until all trade effects commit. */
export async function checkRecordedDisposals(tx: TransactionType, householdId: string, data: DatedTrade, purchaseLotId?: string) {
  const history = await tx.execute(sql`
    select 1 from ${taxLots} l
    where l.holding_id = ${data.holdingId} and l.household_id = ${householdId}
      and l.quantity - l.remaining_quantity <> (select coalesce(sum(d.quantity), 0)
        from ${taxLotDisposals} d where d.tax_lot_id = l.id)
    union all
    select 1 from ${investmentTransactions} s
    left join ${taxLotDisposals} d on d.transaction_id = s.id
    left join ${taxLots} l on l.id = d.tax_lot_id
    left join ${taxLots} new_lot on new_lot.id = ${purchaseLotId ?? null}::uuid
    where s.holding_id = ${data.holdingId} and s.household_id = ${householdId}
      and s.type = 'sell' and s.transaction_date >= ${data.transactionDate}
      and ((${data.type} = 'sell' and s.transaction_date > ${data.transactionDate}) or
        (new_lot.id is not null and (l.id is null or l.created_at is null or
          (new_lot.acquired_date, new_lot.created_at, new_lot.id) < (l.acquired_date, l.created_at, l.id))))
    limit 1`);
  if (history.rows.length) throw new ConflictError(data.type === "sell" ? "Investment sale sources are unavailable" : "Review the holding's recorded FIFO history before posting this trade");
}

export async function recordPurchaseLot(tx: TransactionType, purchase: InvestmentTransaction) {
  if (purchase.type !== "buy" || !purchase.holdingId || !purchase.quantity) throw new ConflictError("Missing purchase lot source");
  const [lot] = await tx.insert(taxLots).values({
    householdId: purchase.householdId, holdingId: purchase.holdingId, transactionId: purchase.id,
    quantity: purchase.quantity, remainingQuantity: purchase.quantity, costBasis: purchase.amount,
    acquiredDate: purchase.transactionDate, costBasisZmw: purchase.amountZmw, acquisitionFxRate: purchase.fxRate,
  }).returning({ id: taxLots.id });
  await checkRecordedDisposals(tx, purchase.householdId, purchase, lot.id);
}
