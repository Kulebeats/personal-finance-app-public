import { sql, type SQL } from "drizzle-orm";
import { auditLogs, holdings, investmentOpeningOperationReceipts, investmentTransactions, securities, taxLots } from "@shared/schema";
import { DATED_INVESTMENT_FX_POLICY } from "../../core/money/investment-income";

function receiptUuid(value: SQL) {
  return sql`case when (${value}) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (${value})::uuid end`;
}

/**
 * Rate-only opening costs can be used while the original lot is intact. Its
 * receipt, purchase, lot and dated verification audit must agree with the
 * holding in the same read. Only the resulting boolean leaves this query.
 */
export function verifiedOpeningRateProjection() {
  return sql<boolean>`coalesce((
    ${holdings.costBasisZmw} is null and ${holdings.acquisitionFxRate} > 0
    and ${securities.currency} <> 'ZMW' and ${holdings.quantity} > 0
    and exists (
      select 1 from ${investmentOpeningOperationReceipts} r
      join ${investmentTransactions} p on p.id = ${receiptUuid(sql`r.creation_snapshot->>'purchaseId'`)}
      join ${taxLots} l on l.id = ${receiptUuid(sql`r.creation_snapshot->>'lotId'`)}
      join ${auditLogs} a on a.entity_id = p.id and a.entity_type = 'investment_transaction'
        and a.action = 'CREATE' and a.user_id = r.actor_user_id and a.household_id is null
      where r.household_id = ${holdings.householdId} and r.holding_id = ${holdings.id}
        and r.currency = ${securities.currency} and r.request_version = 1
        and p.household_id = r.household_id and p.holding_id = r.holding_id
        and p.account_id = ${holdings.accountId} and p.security_id = ${holdings.securityId}
        and p.type = 'buy' and p.currency = r.currency and p.linked_transaction_id is null
        and p.amount = ${holdings.costBasis} and p.amount_zmw is null
        and p.quantity = ${holdings.quantity}
        and p.transaction_date = ${holdings.acquiredDate} and p.fx_rate = ${holdings.acquisitionFxRate}
        and l.transaction_id = p.id and l.household_id = p.household_id and l.holding_id = p.holding_id
        and l.quantity = p.quantity and l.remaining_quantity = l.quantity
        and l.cost_basis = p.amount and l.cost_basis_zmw is null
        and l.acquisition_fx_rate = p.fx_rate and l.acquired_date = p.transaction_date
        and not exists (select 1 from ${taxLots} other
          where other.holding_id = r.holding_id and other.id <> l.id and other.remaining_quantity <> 0)
        and r.creation_snapshot->>'version' = '1'
        and r.creation_snapshot->'holding'->>'accountId' = p.account_id::text
        and r.creation_snapshot->'holding'->>'securityId' = p.security_id::text
        and r.creation_snapshot->'holding'->>'acquisitionFxRate' = p.fx_rate::text
        and r.creation_snapshot->'holding'->>'costBasis' = p.amount::text
        and r.creation_snapshot->'holding'->>'quantity' = p.quantity::text
        and r.creation_snapshot->'holding'->>'acquiredDate' = p.transaction_date::text
        and a.details->>'openingBasis' = 'declared_record_only_v1'
        and a.details->>'openingOperationId' = r.operation_id::text
        and a.details->>'taxLotId' = l.id::text
        and a.details->>'cashMoved' = 'false'
        and a.details->>'fxRateBasis' = ${DATED_INVESTMENT_FX_POLICY}
        and a.details->'fxRateSource'->>'kind' in ('household', 'provider')
        and a.details->'fxRateSource'->>'id' is not null
        and a.details->'fxRateSource'->>'date' is not null
        and a.details->'newValue'->>'type' = 'buy'
        and a.details->'newValue'->>'accountId' = p.account_id::text
        and a.details->'newValue'->>'securityId' = p.security_id::text
        and a.details->'newValue'->>'holdingId' = p.holding_id::text
        and a.details->'newValue'->>'currency' = p.currency
        and a.details->'newValue'->>'amount' = p.amount::text
        and a.details->'newValue'->>'fxRate' = p.fx_rate::text
        and a.details->'newValue'->>'transactionDate' = p.transaction_date::text
    )
  ), false)`;
}
