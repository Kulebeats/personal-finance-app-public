/**
 * Net-worth accumulation with signed liability debt (NEW-05).
 *
 * Sign convention, set by R08 posting (`calculateSignedAccountEffect` in
 * `repositories/TransactionPostingEffect.ts`):
 *  - an asset account's balance is what the holder owns;
 *  - a liability account's balance (isAsset = false) is the debt owed:
 *    positive when money is owed, negative when the account is overpaid
 *    (a credit in the holder's favour). A purchase raises it; a payment
 *    lowers it.
 * Net worth = assets - liabilities, where liabilities is the SIGNED sum of
 * debt. Never take abs(): that turns an overpaid card into debt, so a
 * purchase on it would raise net worth.
 */

import { Money } from "../money";

export interface WealthTotals {
  readonly assets: Money;
  readonly liabilities: Money;
}

export function emptyWealthTotals(currency: string): WealthTotals {
  return { assets: Money.zero(currency), liabilities: Money.zero(currency) };
}

/** Returns new totals with one account's base-currency amount added. */
export function addAccountToWealth(totals: WealthTotals, isAsset: boolean, amount: Money): WealthTotals {
  return isAsset
    ? { assets: totals.assets.add(amount), liabilities: totals.liabilities }
    : { assets: totals.assets, liabilities: totals.liabilities.add(amount) };
}

/**
 * Debt actually owed on one liability balance, for debt metrics (ratios, debt
 * analysis): max(balance, 0). An overpaid card owes nothing and is not debt;
 * its credit already counts in net worth through the signed rule above.
 */
export function owedDebt(liabilityBalance: Money): Money {
  return liabilityBalance.isNegative() ? Money.zero(liabilityBalance.currency) : liabilityBalance;
}

export function netWorthOf(totals: WealthTotals): Money {
  return totals.assets.subtract(totals.liabilities);
}
