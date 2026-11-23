import { Money } from "../core/money";
import type { HouseholdContext } from "../middleware/householdGuard";
import { readInvestmentTaxInputs } from "../repositories/InvestmentTaxRead";
import type { TaxActivity, TaxDisposal } from "../repositories/InvestmentTaxRead";
import { InvestmentTaxDataUnavailable as TaxDataUnavailable } from "../repositories/InvestmentTaxCouponSource";
import { isInvestmentIncome } from "../core/money/investment-income";
import { GENERIC_TBILL_TAX_NAME } from "./grz/instrumentIdentity";

// ZRA (Zambia Revenue Authority) tax reporting is always denominated in ZMW,
// independent of the household's own display currency (Rule 1: this is a
// REGULATORY output, and mixing in the household currency here would be a
// semantic change out of scope for this packet).
const REPORTING_CURRENCY = "ZMW";
function taxMoney(value: string | null) {
  if (value === null) throw new TaxDataUnavailable();
  try {
    const result = new Money(value, REPORTING_CURRENCY);
    if (!result.amount.isFinite() || result.abs().gt("9999999999999.99")) throw new TaxDataUnavailable();
    return result;
  } catch { throw new TaxDataUnavailable(); }
}
function nativeCurrency(currency: string | null) {
  // A row without a server-derived dated conversion (NEW-21) has no trusted
  // ZMW value. Caller-typed base amounts/rates never become a tax conversion.
  if (currency !== REPORTING_CURRENCY) throw new TaxDataUnavailable();
}
/** The stored dated rate of a foreign row whose conversion the writer proved. */
function provenRate(row: Pick<TaxActivity, "fxRate" | "amountZmw" | "fxProven">) {
  if (!row.fxProven || row.amountZmw === null) throw new TaxDataUnavailable();
  const rate = taxMoney(row.fxRate);
  if (!rate.isPositive()) throw new TaxDataUnavailable();
  return rate;
}
// The writer's rounding: half-up to the cent of the amount at the stored rate.
const atRate = (native: Money, rate: Money) => taxMoney(native.multiply(rate.amount).toString());
function declaredIncome(row: TaxActivity) {
  if (!row.currency || !/^[A-Z]{3}$/.test(row.currency)) throw new TaxDataUnavailable();
  // Current instrument metadata may contradict a historical label; it cannot
  // establish a missing historical denomination or an FX conversion.
  if ((row.securityCurrency && row.securityCurrency !== row.currency) || (row.holdingCurrency && row.holdingCurrency !== row.currency)) throw new TaxDataUnavailable();
  const net = taxMoney(row.amount), wht = taxMoney(row.withholdingTax);
  if (wht.isNegative() || ((wht.isZero() || row.hasIncomeDeclaration) && !row.validIncomeDeclaration)) throw new TaxDataUnavailable();
  if (row.currency === REPORTING_CURRENCY) return { net, wht, gross: net.add(wht) };
  const rate = provenRate(row), netZmw = taxMoney(row.amountZmw);
  if (!netZmw.equals(atRate(net, rate))) throw new TaxDataUnavailable();
  const whtZmw = atRate(wht, rate);
  return { net: netZmw, wht: whtZmw, gross: netZmw.add(whtZmw) };
}
/** A ZMW gain, or a foreign gain whose sale and acquisition both carry a proven dated conversion. */
function realizedGainZmw(disposal: TaxDisposal) {
  if (disposal.currency === REPORTING_CURRENCY && disposal.basisCurrency === REPORTING_CURRENCY) return taxMoney(disposal.realizedGain);
  if (!disposal.currency || disposal.currency !== disposal.basisCurrency || !disposal.saleFxProven || disposal.basisFxProven !== true) {
    throw new TaxDataUnavailable();
  }
  return taxMoney(disposal.realizedGainZmw);
}
/** A maturity row the T-bill cron posted: the discount (face less cost, never
 * below zero) is interest, using the withholding actually booked. Its cash
 * proceeds and interest posting must reconcile, or the total is unavailable. */
function tbillInterest(row: TaxActivity) {
  if (row.type !== "maturity" || row.tbillCount === 0) return null;
  if (row.tbillCount !== 1 || row.currency !== REPORTING_CURRENCY) throw new TaxDataUnavailable();
  const face = taxMoney(row.tbillFaceValue), cost = taxMoney(row.tbillPurchasePrice);
  const wht = taxMoney(row.withholdingTax), proceeds = taxMoney(row.amount);
  const discount = face.subtract(cost);
  const gross = discount.isNegative() ? Money.zero(REPORTING_CURRENCY) : discount;
  if (wht.isNegative() || wht.gt(gross.amount) || !proceeds.equals(face.subtract(wht))) throw new TaxDataUnavailable();
  const net = gross.subtract(wht);
  const cash = row.tbillIncomeAmount === null ? null : taxMoney(row.tbillIncomeAmount);
  if (net.isPositive() ? (cash === null || row.tbillIncomeCurrency !== REPORTING_CURRENCY || !cash.equals(net)) : cash !== null) {
    throw new TaxDataUnavailable();
  }
  return { net, wht, gross };
}
/** Income a ZRA return reports: declared investment income or T-bill interest. */
function reportableIncome(row: TaxActivity) {
  return isInvestmentIncome(row.type) ? declaredIncome(row) : tbillInterest(row);
}

export interface TaxYearSummary {
  year: number;
  // Decimal strings (MoneyDto convention) - not JS numbers - so exact
  // regulatory amounts never pick up IEEE-754 float error on serialization.
  realizedGains: string;
  interestIncome: string;
  dividendIncome: string;
  grossIncome: string;
  totalWht: string;
  netIncome: string;
  currency: string;
}

export interface ZraExportRow {
  date: string;
  type: string;
  security: string;
  grossAmount: string;
  whtPaid: string;
  netAmount: string;
  institution: string;
}

export class InvestmentTaxService {
  /**
   * Get tax summary for a specific year
   */
  async getTaxSummary(
    actor: HouseholdContext,
    year: number
  ): Promise<TaxYearSummary> {
    const { activity: txs, disposals, bondSales } = await readInvestmentTaxInputs(actor, year, "financial.read");
    if (!txs.length && !disposals.length && !bondSales.length) return this.emptySummary(year);

    let interestIncome = Money.zero(REPORTING_CURRENCY);
    let dividendIncome = Money.zero(REPORTING_CURRENCY);
    let totalWht = Money.zero(REPORTING_CURRENCY);

    for (const tx of txs) {
      const income = reportableIncome(tx);
      const wht = income?.wht ?? taxMoney(tx.withholdingTax ?? "0");
      if (!income && !wht.isZero()) nativeCurrency(tx.currency);
      totalWht = totalWht.add(wht);

      if (tx.type === "maturity") {
        // Only a cron-posted T-bill maturity is interest; a manual one adds its WHT only.
        if (income) interestIncome = interestIncome.add(income.gross);
      } else if (tx.type === "interest" || tx.type === "coupon") {
        interestIncome = interestIncome.add(income!.gross);
      } else if (tx.type === "dividend") {
        dividendIncome = dividendIncome.add(income!.gross);
      }
    }

    let realizedGains = Money.zero(REPORTING_CURRENCY);
    for (const disposal of disposals) realizedGains = realizedGains.add(realizedGainZmw(disposal));
    // GRZ-03: a GRZ bond sale's recorded ZMW gain or loss, in its sale's tax year.
    for (const sale of bondSales) realizedGains = realizedGains.add(taxMoney(sale.realizedGain));

    const grossIncome = interestIncome
      .add(dividendIncome)
      .add(realizedGains);
    const netIncome = grossIncome.subtract(totalWht);

    return {
      year,
      realizedGains: realizedGains.toString(),
      interestIncome: interestIncome.toString(),
      dividendIncome: dividendIncome.toString(),
      grossIncome: grossIncome.toString(),
      totalWht: totalWht.toString(),
      netIncome: netIncome.toString(),
      currency: REPORTING_CURRENCY, // Reporting currency
    };
  }

  /**
   * Get ZRA Export Data
   */
  async getZraExport(
    actor: HouseholdContext,
    year: number
  ): Promise<ZraExportRow[]> {
    const input = await readInvestmentTaxInputs(actor, year, "financial.export");
    const results = input.activity.flatMap(row => {
      const income = reportableIncome(row);
      return income ? [{ row, income }] : [];
    });

    return results.map(({ row: r, income }) => {
      const { net, wht, gross } = income;
      const isTBill = r.type === "maturity";

      return {
        date: r.date as string,
        type: isTBill ? "interest" : r.type,
        // A bill whose custody this reader cannot see is reported without its name (R1-05).
        security: (isTBill ? r.tbillName ?? GENERIC_TBILL_TAX_NAME : r.securityName || r.securitySymbol) || "Unknown",
        grossAmount: gross.toString(),
        whtPaid: wht.toString(),
        netAmount: net.toString(),
        institution: "Various", // Could fetch from account?
      };
    });
  }

  private emptySummary(year: number): TaxYearSummary {
    const zero = Money.zero(REPORTING_CURRENCY).toString();
    return {
      year,
      realizedGains: zero,
      interestIncome: zero,
      dividendIncome: zero,
      grossIncome: zero,
      totalWht: zero,
      netIncome: zero,
      currency: REPORTING_CURRENCY,
    };
  }
}

export const investmentTaxService = new InvestmentTaxService();
