/**
 * Thandi's cash-flow projection (Astra A-07, A-40).
 *
 * - Recurring rules come from the same authorized read as the product
 *   forecast (`listVisibleRecurringRules`: visible, active, not paused, not
 *   ended) and are counted with the same monthly normalisation
 *   (`normalizeToMonthly`), so a weekly bill counts about 4.33 times a month
 *   and a yearly one a twelfth. A rule past its end date drops out from that
 *   month on, as in the product forecast.
 * - Verified recurring amounts are normalized in their proven unit, then
 *   converted at a trusted as-of quote. A rule with unknown currency makes
 *   its income or expense total unavailable in each month it contributes to.
 * - The opening balance adds each account in its own currency, converted at
 *   the trusted same-day rate the account summary uses. When any account has
 *   no such rate, the projected balance is unknown (null), never a raw sum.
 *
 * @module ai/ai.cashflow-projection
 */
import { addMonths, format, startOfMonth } from "date-fns";
import { db } from "../../db";
import { Money } from "../../core/money";
import { normalizeToMonthly, type RecurringRuleInput } from "../../core/calculations/cashflow/forecast";
import { listVisibleRecurringRules } from "../../services/recurring/RecurringAudienceQuery";
import type { VisibleRecurringRule } from "../../services/recurring/RecurringDenomination";
import { accountValuationRates, readAccountValuationQuotes } from "../../repositories/AccountValuationFx";
import type { HouseholdContext } from "../../core/authz/implicit-household-context";
import type { AccountBalanceResult } from "./ai.types";

export interface CashFlowPoint {
  month: string;
  /** Null when an included rule cannot be valued in the reporting currency. */
  inflow: Money | null;
  outflow: Money | null;
  net: Money | null;
  /** Null when the opening balance or a period's net could not be valued. */
  projectedEndingBalance: Money | null;
}

/**
 * The accounts' total in `currency`: each balance in its own currency,
 * converted at the trusted same-day rate. Null when any account has no rate.
 */
export async function balanceTotalIn(balances: readonly AccountBalanceResult[], currency: string, asOf: Date): Promise<Money | null> {
  const foreign = balances.filter((account) => account.currency !== currency);
  const quotes = foreign.length === 0
    ? []
    : await db.transaction((tx) => readAccountValuationQuotes(tx, foreign.map((account) => account.currency), currency, asOf));
  const rates = accountValuationRates(quotes, currency, asOf);
  let total = Money.zero(currency);
  for (const account of balances) {
    if (account.currency === currency) {
      total = total.add(account.balance);
      continue;
    }
    const rate = rates.get(account.currency);
    if (rate === undefined) return null;
    total = total.add(new Money(account.balance.multiply(rate).toFullString(), currency));
  }
  return total;
}

/** Income and expense rules only: a transfer moves money between accounts, as in the product forecast. */
function isIncomeOrExpense(rule: VisibleRecurringRule): rule is VisibleRecurringRule & { type: "income" | "expense" } {
  return rule.type === "income" || rule.type === "expense";
}

type ForecastRule = VisibleRecurringRule & { type: "income" | "expense" };

function forecastInput(rule: ForecastRule, currency: string): RecurringRuleInput {
  return {
    id: rule.id,
    type: rule.type,
    amount: rule.amount,
    currency,
    frequency: rule.frequency as RecurringRuleInput["frequency"],
    intervalValue: rule.intervalValue,
    intervalUnit: rule.intervalUnit as RecurringRuleInput["intervalUnit"],
    nextDueDate: rule.nextDueDate,
    endDate: rule.endDate,
    isActive: rule.isActive,
    isPaused: rule.isPaused,
  };
}

type RecurringFxQuote = { rate: string; reverse: boolean };

async function readRecurringFxQuote(source: string, target: string, asOf: Date): Promise<RecurringFxQuote | null> {
  return db.transaction(async (tx) => {
    const direct = accountValuationRates(await readAccountValuationQuotes(tx, [source], target, asOf), target, asOf).get(source);
    if (direct) return { rate: direct, reverse: false };

    // The scheduled market feed publishes USD to ZMW. The reciprocal of that
    // same dated observation can value a ZMW rule in a USD forecast.
    const opposite = accountValuationRates(await readAccountValuationQuotes(tx, [target], source, asOf), source, asOf).get(target);
    return opposite ? { rate: opposite, reverse: true } : null;
  });
}

function monthlyTotal(rules: readonly ForecastRule[], type: "income" | "expense", currency: string, quote: RecurringFxQuote | null): Money | null {
  let total = Money.zero(currency);
  for (const rule of rules) {
    if (rule.type !== type) continue;
    const unit = rule.verifiedCurrency;
    if (!unit) return null;
    const amount = normalizeToMonthly(forecastInput(rule, unit), unit);
    if (unit === currency) {
      total = total.add(amount);
      continue;
    }
    if (!quote) return null;
    const value = quote.reverse ? amount.divide(quote.rate) : amount.multiply(quote.rate);
    total = total.add(new Money(value.amount, currency));
  }
  return total;
}

/** Projected inflow, outflow and balance for each of the next `months` calendar months. */
export async function projectCashFlow(params: {
  actor: HouseholdContext;
  currency: string;
  balances: readonly AccountBalanceResult[];
  months: number;
  today?: Date;
}): Promise<CashFlowPoint[]> {
  const { actor, currency, balances, months } = params;
  const today = params.today ?? new Date();
  const rules = (await listVisibleRecurringRules(actor)).filter(isIncomeOrExpense);
  const foreign = rules.find(rule => rule.verifiedCurrency && rule.verifiedCurrency !== currency)?.verifiedCurrency;
  const quote = foreign ? await readRecurringFxQuote(foreign, currency, today) : null;
  let running = await balanceTotalIn(balances, currency, today);

  const points: CashFlowPoint[] = [];
  for (let index = 0; index < months; index++) {
    const periodStart = format(startOfMonth(addMonths(today, index + 1)), "yyyy-MM-dd");
    const nextPeriod = format(startOfMonth(addMonths(today, index + 2)), "yyyy-MM-dd");
    const inMonth = rules.filter(rule => rule.nextDueDate < nextPeriod && (!rule.endDate || rule.endDate >= periodStart));
    const inflow = monthlyTotal(inMonth, "income", currency, quote);
    const outflow = monthlyTotal(inMonth, "expense", currency, quote);
    const net = inflow && outflow ? inflow.subtract(outflow) : null;
    running = running && net ? running.add(net) : null;
    points.push({ month: periodStart.slice(0, 7), inflow, outflow, net, projectedEndingBalance: running });
  }
  return points;
}
