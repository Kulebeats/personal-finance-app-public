import { sql, type SQL } from "drizzle-orm";
import { DATED_INVESTMENT_FX_POLICY } from "../core/money/investment-income";

/** Aliases of investment_transactions rows inside the tax read statement. */
type InvestmentRowAlias = "investment_transactions" | "acquisition";

/**
 * True only when the row's stored fx_rate and amount_zmw are the ones the
 * writer derived from the dated rate (NEW-21) and committed with exactly one
 * actor CREATE audit row. A caller-typed or legacy conversion has no such
 * proof, so its tax amount stays unavailable rather than trusted.
 */
export function datedFxProof(alias: InvestmentRowAlias): SQL {
  const row = sql.raw(`"${alias}"`);
  return sql`(${row}.fx_rate is not null and ${row}.amount_zmw is not null and (
    select count(*) = 1 and count(*) filter (where proof.user_id is not null
      and proof.details->>'fxRateBasis' = ${DATED_INVESTMENT_FX_POLICY}
      and proof.details->'newValue' @> jsonb_build_object('currency', ${row}.currency, 'amount', ${row}.amount::text,
        'fxRate', ${row}.fx_rate::text, 'amountZmw', ${row}.amount_zmw::text, 'transactionDate', ${row}.transaction_date::text)) = 1
    from public.audit_logs proof
    where proof.entity_type = 'investment_transaction' and proof.entity_id = ${row}.id and proof.action = 'CREATE'))`;
}
