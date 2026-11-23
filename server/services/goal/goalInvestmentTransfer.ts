import { investmentTransactions, type Goal } from "@shared/schema";
import type { Money } from "../../core/money";
import { convertInvestmentEventToZmw } from "../../modules/investments/investmentDatedFx";
import { datedConversionAudit } from "../../modules/investments/investmentIncomeWrite";
import type { TransactionType } from "../../utils/withTransaction";

/**
 * F6: a contribution into a holdings-tracked goal is cash moving into the
 * linked investment account, so it is booked like any other investment event.
 * A foreign row stores the dated ZMW base for the contribution date (the
 * household's rate valid that day, else the newest provider rate on or before
 * it). A missing rate is a 422 naming the pair, never rate 1, and nothing is
 * written. A ZMW row keeps its native amount with no typed base, as manual
 * writes do. The result also carries the conversion's audit fields.
 */
export async function postGoalTransferIn(tx: TransactionType, householdId: string, goal: Goal,
  accountId: string, amount: Money, date: string, notes?: string) {
  const conversion = await convertInvestmentEventToZmw(tx, householdId, goal.currency, date, amount.toString(), {});
  const [transaction] = await tx.insert(investmentTransactions).values({
    householdId,
    accountId,
    type: "transfer_in",
    amount: amount.toString(),
    currency: goal.currency,
    fxRate: conversion?.fxRate ?? null,
    amountZmw: conversion?.amountZmw ?? null,
    transactionDate: date,
    notes: notes || `Goal contribution: ${goal.name}`,
  }).returning();
  return { transaction, audit: datedConversionAudit(transaction, conversion?.source) };
}
