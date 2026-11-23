import { sql } from "drizzle-orm";
import type { TransactionType } from "../utils/withTransaction";
import { SnapshotFinancialUnavailable } from "./accountCapture";
import { householdSecurityPriceProjection } from "../services/investment/householdSecurityPriceRead";

/** The legacy portfolio calculator skips bonds and substitutes zero for some missing values.
 * A daily household aggregate may only use it when the observed positions can be valued. */
export async function assertSnapshotPortfolioCoverage(tx: TransactionType, householdId: string) {
  const price = householdSecurityPriceProjection({
    householdId,
    securityId: sql`s.id`,
    currency: sql`s.currency`,
    globalReferencePrice: sql`s.current_price`,
    valuationDate: sql`(transaction_timestamp() AT TIME ZONE 'UTC')::date`,
  });
  const result = await tx.execute<{ unavailable: boolean }>(sql`
    select exists (
      select 1 from holdings h
      join accounts a on a.id = h.account_id
      join securities s on s.id = h.security_id
      where (a.household_id = ${householdId}::uuid or h.household_id = ${householdId}::uuid)
        and h.quantity is distinct from 0
        and (a.household_id <> h.household_id or
          (a.deleted_at is null and a.is_hidden is not true and (
            a.is_hidden is null or h.quantity::text in ('NaN', 'Infinity', '-Infinity')
            or (${price})->>'currentPrice' is null
            or (${price})->>'currentPrice' in ('NaN', 'Infinity', '-Infinity')
            or jsonb_array_length((${price})->'overrides') > 1
            or s.currency !~ '^[A-Z]{3}$'
          )))
      union all
      select 1 from pension_holdings p
      where p.household_id = ${householdId}::uuid
        and (p.current_balance is null or p.current_balance::text in ('NaN', 'Infinity', '-Infinity'))
      union all
      select 1 from grz_tbills t
      where t.household_id = ${householdId}::uuid and (t.status is null or t.status = 'active')
        and t.face_value is distinct from 0
        and (t.status is null or t.face_value is null or t.face_value::text in ('NaN', 'Infinity', '-Infinity'))
      union all
      select 1 from grz_bonds b
      where b.household_id = ${householdId}::uuid and (b.status is null or b.status = 'active')
        and b.face_value is distinct from 0
    ) as unavailable
  `);
  if (result.rows[0].unavailable) throw new SnapshotFinancialUnavailable("INSUFFICIENT_DATA");
}
