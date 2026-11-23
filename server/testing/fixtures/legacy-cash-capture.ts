import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { accountBalanceSnapshots, netWorthSnapshots } from "@shared/schema";
import { db } from "../../db";

/** Seed an explicitly historical 0016-format fixture. No live account value is read. */
export async function seedLegacyCashCapture(householdId: string, date: string,
  checking: { accountId: string; balance: string }, savings?: { accountId: string; balance: string }) {
  const currency = "ZMW";
  const accountBalances = savings ? [checking, savings] : [checking];
  const total = new Decimal(checking.balance).plus(savings?.balance ?? 0).toFixed(2);
  const contributions = accountBalances.map(({ accountId, balance }, i) => ({
    accountId, accountType: i === 0 ? "checking" : "savings", kind: "asset", baseAmount: balance,
    baseCurrency: currency, sourceCurrency: currency, fx: "same_currency",
  }));
  const values = { currency, accountBalances, totalAssets: total, netWorth: total, totalLiabilities: "0.00",
    assetsByType: { checking: checking.balance, ...(savings && { savings: savings.balance }) }, liabilitiesByType: {},
    provenance: { version: 1, captureId: randomUUID(), householdId, date, currency, coverage: "complete",
      investmentsAbsent: true, omittedEligibleAccounts: 0,
      investmentInventory: { holdings: 0, tbills: 0, pensions: 0, bonds: 0 }, contributions } };
  await db.transaction(async tx => {
    await tx.insert(netWorthSnapshots).values({ householdId, date, ...values }).onConflictDoUpdate({
      target: [netWorthSnapshots.householdId, netWorthSnapshots.date], set: values,
    });
    for (const { accountId, balance } of accountBalances) {
      await tx.insert(accountBalanceSnapshots).values({ accountId, date, balance }).onConflictDoUpdate({
        target: [accountBalanceSnapshots.accountId, accountBalanceSnapshots.date], set: { balance },
      });
    }
  });
}
