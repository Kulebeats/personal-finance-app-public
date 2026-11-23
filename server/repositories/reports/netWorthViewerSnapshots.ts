/**
 * Net-worth history as one reader may see it (A-47).
 *
 * A stored snapshot is the household's capture, private accounts included.
 * When no account of the household is hidden from the reader today (archived
 * and soft-deleted ones counted, since they may have contributed), the stored
 * totals and breakdown are exactly what the reader may see and are returned.
 * Otherwise each capture is re-derived from its per-account contributions,
 * keeping only the accounts the reader may see now (the projection the weekly
 * recap uses); stored household totals are never returned, so no figure lets
 * a hidden amount be derived by subtraction. A capture that cannot be proven
 * account by account (investments, unproven FX, omitted accounts) is withheld.
 */
import { and, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";
import { accounts, householdMembers, netWorthSnapshots } from "@shared/schema";
import { db } from "../../db";
import type { TransactionType } from "../../utils/withTransaction";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ForbiddenError } from "../../core/errors";
import { Money } from "../../core/money";
import { decodeCapturedWorth } from "../CapturedWorthProof";
import { moneyFromValue } from "./moneyUtils";

export interface ViewerSnapshot {
  date: string;
  currency: string;
  /** The capture currency's rate into the report currency on that date, if any. */
  fxRate: string | number | null;
  netWorth: Money;
  assets: Money;
  liabilities: Money;
  assetsByType: Record<string, Money> | null;
  liabilitiesByType: Record<string, Money> | null;
}

const addTo = (totals: Record<string, Money>, type: string, amount: Money): Record<string, Money> =>
  ({ ...totals, [type]: totals[type] ? totals[type].add(amount) : amount });

function storedByType(value: unknown, currency: string): Record<string, Money> | null {
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value as Record<string, string | number>)
    .map(([type, amount]) => [type, new Money(String(amount), currency)]));
}

/** Any account of the household, deleted or archived included, this reader may not see. */
async function hasHiddenAccount(tx: TransactionType, actor: HouseholdContext): Promise<boolean> {
  const [hidden] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.householdId, actor.householdId),
    sql`not coalesce(${accounts.isPrivate} = false or ${accounts.ownerUserId} = ${actor.userId}, false)`)).limit(1);
  return Boolean(hidden);
}

/** Reads the captures in range and the reader's current access in one read-only snapshot. */
export function readViewerSnapshots(householdId: string, userId: string, range: { from: string; to: string },
  fxRateExpr: SQL): Promise<ViewerSnapshot[]> {
  return db.transaction(async (tx) => {
    const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).limit(1);
    if (!member || !can(member.role, "financial.read")) throw new ForbiddenError("Net worth access denied");
    const actor = { householdId, userId, role: member.role };
    const rows = await tx.select({
      id: netWorthSnapshots.id, householdId: netWorthSnapshots.householdId, date: netWorthSnapshots.date,
      currency: netWorthSnapshots.currency, totalAssets: netWorthSnapshots.totalAssets,
      totalLiabilities: netWorthSnapshots.totalLiabilities, netWorth: netWorthSnapshots.netWorth,
      assetsByType: netWorthSnapshots.assetsByType, liabilitiesByType: netWorthSnapshots.liabilitiesByType,
      accountBalances: netWorthSnapshots.accountBalances, provenance: netWorthSnapshots.provenance,
      fxRate: sql<string | number | null>`${fxRateExpr}`,
    }).from(netWorthSnapshots)
      .where(and(eq(netWorthSnapshots.householdId, householdId), gte(netWorthSnapshots.date, range.from),
        lte(netWorthSnapshots.date, range.to)))
      .orderBy(netWorthSnapshots.date);
    if (!rows.length) return [];

    if (!(await hasHiddenAccount(tx, actor))) {
      return rows.map((row) => ({
        date: row.date, currency: row.currency, fxRate: row.fxRate,
        netWorth: moneyFromValue(row.netWorth, row.currency),
        assets: moneyFromValue(row.totalAssets, row.currency),
        liabilities: moneyFromValue(row.totalLiabilities, row.currency),
        assetsByType: storedByType(row.assetsByType, row.currency),
        liabilitiesByType: storedByType(row.liabilitiesByType, row.currency),
      }));
    }

    const frames = rows.flatMap((row) => {
      const frame = decodeCapturedWorth(row);
      return frame ? [{ frame, fxRate: row.fxRate }] : [];
    });
    const sourceIds = Array.from(new Set(frames.flatMap(({ frame }) => frame.facts.contributions.map((item) => item.accountId))));
    const visible = sourceIds.length
      ? await tx.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, sourceIds), visibleAccountPredicate(actor)))
      : [];
    const visibleIds = new Set(visible.map((account) => account.id));
    return frames.map(({ frame, fxRate }) => {
      const currency = frame.row.currency;
      const view = frame.facts.contributions.filter((item) => visibleIds.has(item.accountId)).reduce((total, item) => {
        const amount = new Money(item.baseAmount, currency);
        // NEW-05: liabilities are signed debt; an overpaid card lowers them.
        return item.kind === "liability"
          ? { ...total, liabilities: total.liabilities.add(amount), liabilitiesByType: addTo(total.liabilitiesByType, item.accountType, amount) }
          : { ...total, assets: total.assets.add(amount), assetsByType: addTo(total.assetsByType, item.accountType, amount) };
      }, { assets: Money.zero(currency), liabilities: Money.zero(currency),
        assetsByType: {} as Record<string, Money>, liabilitiesByType: {} as Record<string, Money> });
      return { date: frame.row.date, currency, fxRate, netWorth: view.assets.subtract(view.liabilities), ...view };
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
