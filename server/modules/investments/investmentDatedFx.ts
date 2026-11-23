import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { CalculationError } from "../../core/calculations/errors";
import { ConflictError, HttpError, ValidationError } from "../../core/errors";
import { DATED_INVESTMENT_FX_POLICY } from "../../core/money/investment-income";
import { logger } from "../../utils/logger";
import type { TransactionType } from "../../utils/withTransaction";

const BASE_CURRENCY = "ZMW";
// investment_transactions.fx_rate and tax_lots.acquisition_fx_rate are
// NUMERIC(18,8) since 0041, matching household rates' 8 places; amount_zmw is NUMERIC(15,2).
const RATE_SCALE = 8;
const RATE_LIMIT = "1000000";
const AMOUNT_LIMIT = "9999999999999.99";
const Exact = Decimal.clone({ precision: 48, rounding: Decimal.ROUND_HALF_UP });
/**
 * Lane 3 (NEW-21 F4), a proposed bound awaiting owner sign-off: a provider
 * rate older than this many days before the event is stale and refused. A
 * household's own rate carries its validity window, so it has no extra bound.
 */
export const PROVIDER_FX_MAX_AGE_DAYS = 7;

export class InvestmentFxRateUnsupported extends HttpError {
  readonly statusCode = 422;
  readonly code = "FX_RATE_UNSUPPORTED";
  constructor(from: string, date: string) {
    super(`The ${from} to ${BASE_CURRENCY} rate on ${date} has more than ${RATE_SCALE} decimal places, so it can't be stored with this event`);
  }
}

export class InvestmentFxRateStale extends HttpError {
  readonly statusCode = 422;
  readonly code = "FX_RATE_STALE";
  constructor(readonly details: { from: string; to: string; date: string; rateDate: string }) {
    super(`The newest ${details.from} to ${details.to} provider rate on or before ${details.date} is from ${details.rateDate}, `
      + `more than ${PROVIDER_FX_MAX_AGE_DAYS} days earlier. An owner or admin can record a rate for this date.`);
  }
  toJSON() {
    const body = super.toJSON();
    return { ...body, error: { ...body.error, details: this.details } };
  }
}

/** The rate row a conversion used: the household's own rate, or a provider rate. */
export interface FxRateSource { kind: "household" | "provider"; id: string; date: string }
export interface DatedZmwConversion { fxRate: string; amountZmw: string; source: FxRateSource }
type RateRow = { kind: FxRateSource["kind"]; id: string; rate: string; rate_date: string; age_days: number };
export interface ClaimedConversion { fxRate?: string; amountZmw?: string }

/** One event amount converted at the rate stored with it. Readers use the same
 * rounding (half-up to the cent) for any other amount of that event. */
export function convertAtStoredRate(amount: string, fxRate: string): string {
  return new Exact(amount).times(fxRate).toDecimalPlaces(2).toFixed(2);
}

/**
 * The rate row for one date. Its predicates mirror R12 `resolvedFxRate`
 * (reports): the household's rate valid on the date, newest effective date
 * first, else the newest shared provider rate dated on or before it. It also
 * returns which row was used, so the audit can name it.
 */
async function datedRateRow(tx: TransactionType, householdId: string, currency: string, date: string): Promise<RateRow | null> {
  const result = await tx.execute<RateRow>(sql`
    with own as (
      select 'household'::text as kind, o.id::text as id, o.rate::numeric::text as rate,
        to_char(o.effective_date, 'YYYY-MM-DD') as rate_date, (${date}::date - o.effective_date)::int as age_days
      from household_fx_rate_overrides o
      where o.household_id = ${householdId}::uuid and o.from_currency = ${currency}::text
        and o.to_currency = ${BASE_CURRENCY}::text and o.effective_date <= ${date}::date and o.valid_through >= ${date}::date
      order by o.effective_date desc limit 1),
    shared as (
      select 'provider'::text as kind, s.id::text as id, s.rate::numeric::text as rate,
        to_char(s.date, 'YYYY-MM-DD') as rate_date, (${date}::date - s.date)::int as age_days
      from fx_rates s
      where s.from_currency = ${currency}::text and s.to_currency = ${BASE_CURRENCY}::text and s.date <= ${date}::date
      -- fx_rates has no unique (from, to, date): the lower id breaks a same-day tie, as in resolvedFxRate.
      order by s.date desc, s.id asc limit 1)
    select * from own
    union all
    select * from shared where not exists (select 1 from own)`);
  return result.rows[0] ?? null;
}

const rateChanged = () => new ConflictError("The exchange rate changed while this was being recorded; retry");

/**
 * Hold the chosen row FOR SHARE until the writer commits, so it cannot change
 * in place between this choice and the SIP fill proof's re-check of it. Under
 * the lock the row must still be eligible for the event exactly as chosen:
 * same household scope, pair, dated window covering the date, date and rate
 * (FOR SHARE re-evaluates these on the latest version). It must also still be
 * the row the converter would choose, which catches a newer row committed
 * meanwhile. Any change is a retryable 409, before anything is written.
 * A SIP writer repeats the choice check just before its proof INSERT; a row
 * committed between that check and the INSERT still fails closed at the proof
 * (each statement takes a new snapshot), and a retry then succeeds.
 */
async function holdRateRow(tx: TransactionType, row: RateRow, householdId: string, currency: string, date: string): Promise<void> {
  const locked = await tx.execute<{ rate: string }>(row.kind === "household"
    ? sql`select o.rate::numeric::text as rate from household_fx_rate_overrides o
        where o.id = ${row.id}::uuid and o.household_id = ${householdId}::uuid and o.from_currency = ${currency}::text
          and o.to_currency = ${BASE_CURRENCY}::text and o.effective_date <= ${date}::date and o.valid_through >= ${date}::date
          and to_char(o.effective_date, 'YYYY-MM-DD') = ${row.rate_date}
        for share`
    : sql`select s.rate::numeric::text as rate from fx_rates s
        where s.id = ${row.id}::uuid and s.from_currency = ${currency}::text and s.to_currency = ${BASE_CURRENCY}::text
          and s.date <= ${date}::date and to_char(s.date, 'YYYY-MM-DD') = ${row.rate_date}
        for share`);
  const current = locked.rows[0];
  if (!current || !new Exact(current.rate).eq(row.rate)) throw rateChanged();
  await assertRateRowStillChosen(tx, householdId, currency, date, row);
}

/**
 * Refuse with a retryable 409 unless the converter would still choose this
 * row for the event. The SIP fill proof re-checks the same choice at INSERT,
 * so a SIP writer calls this just before it to name a row committed after the
 * lock-time check, instead of failing the proof as an opaque 500.
 */
export async function assertRateRowStillChosen(tx: TransactionType, householdId: string, currency: string, date: string,
  source: Pick<FxRateSource, "kind" | "id">): Promise<void> {
  const chosen = await datedRateRow(tx, householdId, currency, date);
  if (chosen?.id !== source.id || chosen.kind !== source.kind) throw rateChanged();
}

/**
 * The ZMW value of a foreign investment event, using the rate for the event's
 * own date: the household's rate valid on that date, else the shared provider
 * rate dated on or before it (R12 `resolvedFxRate`). Runs inside the writer's
 * transaction. A ZMW event needs no conversion and returns null. A missing
 * rate is a 422, never rate 1; so is a provider rate more than
 * PROVIDER_FX_MAX_AGE_DAYS older than the event. A caller value that disagrees
 * is a 400. The result names the rate row used.
 */
export async function convertInvestmentEventToZmw(tx: TransactionType, householdId: string, currency: string,
  date: string, amount: string, claimed: ClaimedConversion): Promise<DatedZmwConversion | null> {
  if (currency === BASE_CURRENCY) return null;
  const row = await datedRateRow(tx, householdId, currency, date);
  const rate = row === null ? null : new Exact(row.rate);
  if (row === null || rate === null || !rate.isFinite() || rate.lte(0)) {
    throw new CalculationError("MISSING_FX_RATE", { from: currency, to: BASE_CURRENCY, date });
  }
  if (row.kind === "provider" && row.age_days > PROVIDER_FX_MAX_AGE_DAYS) {
    const stale = new InvestmentFxRateStale({ from: currency, to: BASE_CURRENCY, date, rateDate: row.rate_date });
    logger.warn("Stale exchange rate", stale.details);
    throw stale;
  }
  if (rate.decimalPlaces() > RATE_SCALE || rate.gte(RATE_LIMIT)) throw new InvestmentFxRateUnsupported(currency, date);
  await holdRateRow(tx, row, householdId, currency, date);
  const fxRate = rate.toFixed(RATE_SCALE);
  const amountZmw = convertAtStoredRate(amount, fxRate);
  if (new Exact(amountZmw).abs().gt(AMOUNT_LIMIT)) throw new ValidationError("The converted ZMW amount is too large to store");
  if ((claimed.fxRate !== undefined && !new Exact(claimed.fxRate).eq(fxRate)) ||
    (claimed.amountZmw !== undefined && !new Exact(claimed.amountZmw).eq(amountZmw))) {
    throw new ValidationError(`The conversion must use the ${currency} to ${BASE_CURRENCY} rate for ${date} (${fxRate})`);
  }
  return { fxRate, amountZmw, source: { kind: row.kind, id: row.id, date: row.rate_date } };
}

export { DATED_INVESTMENT_FX_POLICY };
