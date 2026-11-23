import { getTableColumns, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { householdSecurityPriceOverrides, securities } from "@shared/schema";
import { ConflictError, HttpError } from "../../core/errors";
import { Money } from "../../core/money";

export interface HouseholdSecurityPriceSelection {
  currentPrice: string | null;
  overrides: {
    id: string;
    effectiveDate: string;
    validThrough: string;
    price: string;
    currency: string;
    source: string;
    actorUserId: string;
    recordedAt: string;
  }[];
}

interface HouseholdSecurityPriceProjectionInput {
  householdId: string | SQLWrapper;
  securityId: SQLWrapper;
  currency: SQLWrapper;
  globalReferencePrice: SQLWrapper;
  valuationDate: SQLWrapper;
}

/** Keep the selected price and its dated author evidence in the source query. */
export function householdSecurityPriceProjection(
  input: HouseholdSecurityPriceProjectionInput,
): SQL<HouseholdSecurityPriceSelection> {
  const mark = alias(householdSecurityPriceOverrides, "eligible_household_security_price");
  const body = sql`(select jsonb_build_object(
    'currentPrice', case when count(*) = 0 then
      case when ${input.globalReferencePrice}::text in ('NaN', 'Infinity', '-Infinity') then null
        else ${input.globalReferencePrice}::text end
      when count(*) = 1 then min(${mark.price})::text else null end,
    'overrides', coalesce(jsonb_agg(jsonb_build_object(
      'id', ${mark.id}, 'effectiveDate', ${mark.effectiveDate}::text,
      'validThrough', ${mark.validThrough}::text, 'price', ${mark.price}::text,
      'currency', ${mark.currency}, 'source', ${mark.source},
      'actorUserId', ${mark.actorUserId},
      'recordedAt', to_char(${mark.recordedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ) order by ${mark.id}), '[]'::jsonb))
    from ${householdSecurityPriceOverrides} as ${mark}
    where ${mark.householdId} = ${input.householdId}::uuid
      and ${mark.securityId} = ${input.securityId}
      and ${mark.currency} = ${input.currency}
      and ${mark.effectiveDate} <= ${input.valuationDate}::date
      and ${mark.validThrough} >= ${input.valuationDate}::date)`;
  // A single-table select strips table names from top-level column chunks, which
  // would rebind "id" and "currency" to the inner price table. A nested SQL keeps
  // every column qualified for every caller.
  return sql<HouseholdSecurityPriceSelection>`${body}`;
}

/** This household's price evidence for the joined security on the current UTC date. */
export function householdSecurityPriceEvidence(householdId: string | SQLWrapper): SQL<HouseholdSecurityPriceSelection> {
  return householdSecurityPriceProjection({
    householdId,
    securityId: securities.id,
    currency: securities.currency,
    globalReferencePrice: securities.currentPrice,
    valuationDate: sql`(transaction_timestamp() AT TIME ZONE 'UTC')::date`,
  });
}

/** The securities columns with currentPrice resolved to this household's eligible
 * price for the current UTC date, or the shared reference when it has none. */
export function householdPricedSecurityColumns(householdId: string | SQLWrapper) {
  const priceEvidence = householdSecurityPriceEvidence(householdId);
  return { ...getTableColumns(securities), currentPrice: sql<string | null>`((${priceEvidence})->>'currentPrice')` };
}

class HouseholdSecurityPriceUnavailable extends HttpError {
  readonly statusCode = 422;
  readonly code = "FINANCIAL_DATA_UNAVAILABLE";
}

/** The valuation has no usable price (or share count); callers show it as unavailable, never as zero. */
export function isHouseholdSecurityPriceUnavailable(error: unknown): boolean {
  return error instanceof HouseholdSecurityPriceUnavailable;
}

/** Call within the valuation outcome that is revalidated before publication. */
export function assertHouseholdSecurityPriceAvailable(
  selection: HouseholdSecurityPriceSelection,
  quantity: string | null,
) {
  if (selection.overrides.length > 1) {
    throw new ConflictError("Household security price periods overlap. Resolve the overlapping prices and try again.");
  }
  const shares = new Money(quantity ?? "0");
  if (!shares.amount.isFinite()) {
    throw new HouseholdSecurityPriceUnavailable("The holding valuation is unavailable because its share quantity is invalid.");
  }
  if (shares.isZero()) return;
  if (selection.currentPrice === null || !new Money(selection.currentPrice).amount.isFinite()) {
    throw new HouseholdSecurityPriceUnavailable("The holding valuation is unavailable because a security price is missing.");
  }
}
