/**
 * Per-test households for the r04-based GRZ sale suites. A settled sale's bond and its
 * cash cannot be deleted while the household lives (migration 0039, like 0025's principal
 * events), so each test erases both r04 households in one transaction, as account erasure
 * does, then recreates them under the same ids for the next test.
 */
import { inArray } from "drizzle-orm";
import { grzBondPayments, grzBonds, householdMembers, households, investmentTransactions, transactions } from "@shared/schema";
import { db } from "../../db";
import { a, actors, b, reset } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

export async function eraseSaleHouseholds(): Promise<void> {
  await db.transaction(async tx => {
    const owned = tx.select({ id: grzBonds.id }).from(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
    await tx.delete(grzBondPayments).where(inArray(grzBondPayments.bondId, owned));
    await tx.delete(grzBonds).where(inArray(grzBonds.householdId, [a, b]));
    await tx.delete(investmentTransactions).where(inArray(investmentTransactions.householdId, [a, b]));
    await tx.delete(transactions).where(inArray(transactions.householdId, [a, b]));
    await tx.delete(households).where(inArray(households.id, [a, b]));
  });
}

/** Erase, recreate the two households and the outsider's grant, then the r04 seed. */
export async function freshSaleHouseholds(): Promise<void> {
  await eraseSaleHouseholds();
  await db.insert(households).values([{ id: a, name: "Synthetic A5 A", currency: "ZMW" }, { id: b, name: "Synthetic A5 B", currency: "ZMW" }]);
  await db.insert(householdMembers).values({ householdId: b, userId: actors.get("outsider")!.id, role: "owner" });
  await reset();
}
