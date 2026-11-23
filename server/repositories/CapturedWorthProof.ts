import { accountTypeEnum, netWorthSnapshots } from "@shared/schema";
import { z } from "zod";
import { Money } from "../core/money";

const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const contribution = z.object({ accountId: uuid, kind: z.enum(["asset", "liability"]), accountType: z.enum(accountTypeEnum.enumValues),
  baseAmount: decimal, sourceCurrency: currency.nullable(), baseCurrency: currency, fx: z.enum(["same_currency", "unproven"]) });
const evidence = z.object({ version: z.literal(1), captureId: uuid, householdId: uuid, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), currency,
  coverage: z.literal("complete"), investmentsAbsent: z.literal(true),
  investmentInventory: z.object({ holdings: z.literal(0), tbills: z.literal(0), pensions: z.literal(0), bonds: z.literal(0) }),
  omittedEligibleAccounts: z.literal(0), contributions: z.array(contribution) });
export type CapturedWorthRow = Pick<typeof netWorthSnapshots.$inferSelect,
  "id" | "householdId" | "date" | "currency" | "totalAssets" | "totalLiabilities" | "netWorth" | "accountBalances" | "provenance">;
type Row = CapturedWorthRow;
type Frame = { row: Row; facts: z.infer<typeof evidence> };

export function decodeCapturedWorth(row: Row): Frame | null {
  const parsed = evidence.safeParse(row.provenance);
  const details = z.array(z.object({ accountId: uuid, balance: decimal })).safeParse(row.accountBalances);
  if (!parsed.success || !details.success) return null;
  const facts = parsed.data;
  if (facts.householdId !== row.householdId || facts.date !== row.date || facts.currency !== row.currency) return null;
  const ids = new Set(facts.contributions.map(item => item.accountId));
  if (ids.size !== facts.contributions.length || details.data.length !== ids.size || new Set(details.data.map(item => item.accountId)).size !== ids.size) return null;
  try {
    let assets = Money.zero(row.currency), liabilities = Money.zero(row.currency);
    for (const item of facts.contributions) {
      if (item.baseCurrency !== row.currency || item.sourceCurrency !== row.currency || item.fx !== "same_currency") return null;
      if ((item.kind === "liability") !== ["credit", "loan", "mortgage", "other_liability"].includes(item.accountType)) return null;
      const detail = details.data.find(value => value.accountId === item.accountId);
      const value = new Money(item.baseAmount, row.currency);
      if (!detail || !value.subtract(new Money(detail.balance, row.currency)).isZero()) return null;
      if (item.kind === "liability") liabilities = liabilities.add(value); // NEW-05 signed debt
      else assets = assets.add(value);
    }
    if (!assets.subtract(new Money(row.totalAssets, row.currency)).isZero() ||
        !liabilities.subtract(new Money(row.totalLiabilities, row.currency)).isZero() ||
        !assets.subtract(liabilities).subtract(new Money(row.netWorth, row.currency)).isZero()) return null;
    return { row, facts };
  } catch { return null; } // Malformed captured data is unavailable; query failures still reject.
}

/** The capture supplies economic kind and denomination; current accounts supply access only. */
export function projectCapturedWorth(frame: NonNullable<ReturnType<typeof decodeCapturedWorth>>, visibleIds: ReadonlySet<string>) {
  let assets = Money.zero(frame.row.currency), liabilities = Money.zero(frame.row.currency);
  for (const item of frame.facts.contributions) if (visibleIds.has(item.accountId)) {
    const amount = new Money(item.baseAmount, frame.row.currency);
    // NEW-05: liabilities are signed debt; an overpaid card lowers them.
    if (item.kind === "liability") liabilities = liabilities.add(amount);
    else assets = assets.add(amount);
  }
  return { money: assets.subtract(liabilities), assets, liabilities, date: frame.row.date, currency: frame.row.currency };
}
