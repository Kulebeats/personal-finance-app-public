import { z } from "zod";
import { accountTypeEnum, type accountWorthCaptures } from "@shared/schema";
import { isCurrencyCode } from "@shared/denomination";
import { Money } from "../core/money";

type Row = Pick<typeof accountWorthCaptures.$inferSelect,
  "id" | "householdId" | "date" | "captureId" | "capturedAt" | "currency" | "evidence">;
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const count = z.number().int().nonnegative();
const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const envelope = z.object({ version: z.literal(1), captureId: uuid, householdId: uuid, date: day,
  capturedAt: z.string().datetime({ offset: true }), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  inventoryComplete: z.literal(true), capturedAccountCount: count,
  accounts: z.array(z.object({ accountId: uuid }).passthrough()),
}).strict();
const record = z.object({ accountId: uuid, accountType: z.enum(accountTypeEnum.enumValues),
  sourceAmount: decimal.nullable(), sourceCurrency: z.string().nullable(),
  excluded: z.boolean().nullable(), hidden: z.boolean().nullable(), archived: z.boolean().nullable(), deleted: z.boolean(),
  investments: z.object({ holdings: count, tbills: count, pensions: count, bonds: count }).strict(),
}).strict();

/** Validate the exhaustive capture envelope, then economic completeness only
 * for this live audience. Private or unattributed positions confer no grant. */
export function projectNativeAccountCapture(row: Row, visibleAccountIds: ReadonlySet<string>) {
  const parsed = envelope.safeParse(row.evidence);
  if (!parsed.success || !isCurrencyCode(row.currency)) return null;
  const facts = parsed.data;
  if (facts.householdId !== row.householdId || facts.date !== row.date || facts.currency !== row.currency ||
      facts.captureId !== row.captureId || new Date(facts.capturedAt).getTime() !== row.capturedAt.getTime() ||
      facts.capturedAccountCount !== facts.accounts.length || new Set(facts.accounts.map(item => item.accountId)).size !== facts.accounts.length) return null;
  let assets = Money.zero(row.currency), liabilities = Money.zero(row.currency);
  for (const candidate of facts.accounts) {
    if (!visibleAccountIds.has(candidate.accountId)) continue;
    const current = record.safeParse(candidate);
    if (!current.success) return null;
    const item = current.data;
    if (item.deleted) continue;
    if (!Object.values(item.investments).every(value => value === 0)) return null;
    if (item.excluded === true) continue;
    if (item.sourceAmount === null) return null;
    let amount: Money;
    try { amount = new Money(item.sourceAmount, row.currency); } catch { return null; }
    if (!amount.amount.isFinite()) return null;
    // A proven zero needs no invented FX rate or economic exclusion policy.
    if (amount.isZero()) continue;
    if (item.excluded !== false || item.hidden !== false || item.archived !== false || item.sourceCurrency !== row.currency) return null;
    if (["credit", "loan", "mortgage", "other_liability"].includes(item.accountType)) liabilities = liabilities.add(amount); // NEW-05 signed debt
    else assets = assets.add(amount);
  }
  return { date: row.date, currency: row.currency, assets, liabilities, money: assets.subtract(liabilities) };
}
