import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { accounts, householdMembers, netWorthSnapshots } from "@shared/schema";
import { db } from "../../db";
import type { TransactionType } from "../../utils/withTransaction";
import { can } from "../../core/authz/capabilities";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { ForbiddenError } from "../../core/errors";
import { toMoneyDto } from "../../core/money";
import type { NetWorthData } from "@shared/weekly-recap";

export type { CapturedWorthRow } from "../../repositories/CapturedWorthProof";
import { decodeCapturedWorth, projectCapturedWorth, type CapturedWorthRow as Row } from "../../repositories/CapturedWorthProof";

function previousWindow(from: string) {
  const start = new Date(`${from}T00:00:00Z`), end = new Date(start);
  start.setUTCDate(start.getUTCDate() - 7); end.setUTCDate(end.getUTCDate() - 1);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/** Each batch reads both periods and all their live source accounts in one snapshot. */
export async function readRecipientWorthBatch(householdId: string, userId: string, windows: Array<{ from: string; to: string }>): Promise<NetWorthData[]> {
  if (!windows.length) return [];
  return db.transaction(tx => projectRecipientWorth(tx, householdId, userId, windows),
    { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function projectRecipientWorth(
  tx: TransactionType, householdId: string, userId: string, windows: Array<{ from: string; to: string }>,
): Promise<NetWorthData[]> {
  const [member] = await tx.select({ role: householdMembers.role }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId))).limit(1);
  if (!member || !can(member.role, "financial.read")) throw new ForbiddenError("Weekly recap access denied");
  const actor = { householdId, userId, role: member.role };
  const previous = windows.map(window => previousWindow(window.from));
  const from = previous.map(window => window.from).sort()[0], to = windows.map(window => window.to).sort().at(-1)!;
  const rows = await tx.select().from(netWorthSnapshots).where(and(eq(netWorthSnapshots.householdId, householdId),
    gte(netWorthSnapshots.date, from), lte(netWorthSnapshots.date, to))).orderBy(netWorthSnapshots.date);
  const frames = new Map(rows.map(row => [row.id, decodeCapturedWorth(row)]));
  const sourceIds = Array.from(new Set(Array.from(frames.values()).flatMap(frame => frame?.facts.contributions.map(item => item.accountId) ?? [])));
  const visible = sourceIds.length ? await tx.select({ id: accounts.id }).from(accounts)
    .where(and(inArray(accounts.id, sourceIds), visibleAccountPredicate(actor))) : [];
  return formatCapturedWorth(rows, new Set(visible.map(account => account.id)), windows, frames);
}

export function formatCapturedWorth(rows: Row[], visibleIds: Set<string>, windows: Array<{ from: string; to: string }>,
  frames = new Map(rows.map(row => [row.id, decodeCapturedWorth(row)]))): NetWorthData[] {
  const previous = windows.map(window => previousWindow(window.from));
  function value(row: Row | undefined) {
    const frame = row && frames.get(row.id);
    if (!frame) return null;
    return projectCapturedWorth(frame, visibleIds);
  }
  return windows.map<NetWorthData>((window, index) => {
    const currentRows = rows.filter(row => row.date >= window.from && row.date <= window.to);
    const previousRows = rows.filter(row => row.date >= previous[index].from && row.date <= previous[index].to);
    const current = value(currentRows.at(-1)), prior = value(previousRows.at(-1));
    const sameCurrency = current && prior && current.currency === prior.currency;
    const change = sameCurrency ? current.money.subtract(prior.money) : null;
    const percent = change && prior && !prior.money.isZero() ? change.divide(prior.money.abs().toString()).multiply("100") : null;
    const denomination = current?.currency ?? prior?.currency ?? null;
    return {
      status: current && prior && sameCurrency ? "available" : current || prior ? "partial" : "unavailable",
      currency: denomination, asOf: current?.date ?? null, previousAsOf: prior?.date ?? null,
      current: current?.money.toNumber() ?? null, previous: prior && (!current || sameCurrency) ? prior.money.toNumber() : null,
      change: change?.toNumber() ?? null, changePercent: percent?.amount.toDecimalPlaces(2).toNumber() ?? null,
      currentMoney: current ? toMoneyDto(current.money) : null, previousMoney: prior ? toMoneyDto(prior.money) : null,
      changeMoney: change ? toMoneyDto(change) : null,
      trend: change ? change.isZero() ? "steady" : change.isNegative() ? "down" : "up" : null,
      series: currentRows.flatMap(row => { const point = value(row); return point ? [{ date: point.date, value: point.money.toNumber(), currency: point.currency }] : []; }),
    };
  });
}

export async function readRecipientWorth(householdId: string, userId: string, from: string, to: string) {
  return (await readRecipientWorthBatch(householdId, userId, [{ from, to }]))[0];
}
