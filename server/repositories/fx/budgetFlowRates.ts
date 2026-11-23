import { sql, type SQL } from "drizzle-orm";
import { resolvedFxRateSource, type FxBaseCurrency } from "./resolvedFxRate";

// The body of a budget read's `selected_quotes` CTE (FIN-06): one row per
// foreign (currency, date) among the enclosing statement's nonzero
// `grouped_flows`, with the rate Reports would use for that day and the id of
// the rate row it came from. `rate` is NULL when no rate resolves; callers
// fail closed on it and never substitute 1.
//
// Columns: from_currency, effective_date, rate, override_id, shared_id.
export function budgetFlowRates(householdId: string, baseCurrency: FxBaseCurrency): SQL {
  return sql`select k.from_currency,k.effective_date,r.rate,r.override_id,r.shared_id from (
      select distinct f.currency as from_currency,f.date as effective_date from grouped_flows f
      where f.currency<>${baseCurrency}::text and f.amount<>0) k
    left join lateral ${resolvedFxRateSource(householdId, sql`k.from_currency`, baseCurrency, sql`k.effective_date`)} r on true`;
}
