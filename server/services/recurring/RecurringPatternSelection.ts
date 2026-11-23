import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, households, userDisplaySettings, users, type Transaction } from "@shared/schema";
import { MAX_PATTERN_CONTRIBUTORS, patternOptionsSchema, type PatternOptions, type PatternSelection } from "@shared/recurring-pattern";
import { db } from "../../db";
import { Money } from "../../core/money";
import { recurringRepository } from "../../repositories/RecurringRepository";
import { transactionQueryRepository } from "../../repositories/TransactionQueryRepository";
import type { TransactionType } from "../../utils/withTransaction";
import type { HouseholdContext } from "../../middleware/householdGuard";
import type { Frequency } from "../../core/calculations/recurring/types";
import { NotFoundError, ValidationError } from "../../utils/errorHandler";
import { visibleAccountPredicate } from "../../core/authz/transaction-visibility";

export interface SignedPattern {
  name: string; type: "income" | "expense"; merchantId: string | null;
  estimatedAmount: string; currency: string; amountVariance: number; amountTolerance: number;
  frequency: string; dayOfMonth?: number; dayOfWeek?: number; confidence: number;
  occurrences: number; sampleTransactionIds: string[]; suggestedStartDate: string; suggestedNextDueDate: string;
  selection?: PatternSelection; confirmationIssue?: string;
}
export const denominationIssue = "Recurring rules cannot yet preserve this denomination through reports and scheduled posting. Use supported ZMW sources and account, or wait for explicit multi-currency recurring support; no conversion was performed.";
export const rescanIssue = "The detected selection changed or is incomplete. Scan again before adding this rule.";
/** Existing personal settings precedence, with no invented ambient/household timezone. */
export async function readPatternTimezone(tx: TransactionType, userId: string, lock = false) {
  const profileQuery = tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  const [profile] = await (lock ? profileQuery.for("share") : profileQuery);
  const settingsQuery = tx.select({ timezone: userDisplaySettings.timezone }).from(userDisplaySettings).where(eq(userDisplaySettings.userId, userId));
  const [settings] = await (lock ? settingsQuery.for("share") : settingsQuery);
  if (settings?.timezone) return { timezone: settings.timezone, timezoneSource: "display" as const };
  if (profile?.timezone) return { timezone: profile.timezone, timezoneSource: "profile" as const };
  throw new ValidationError("Set your display or profile timezone before scanning recurring history.");
}
export function resolvePatternWindow(options: PatternOptions, timezone: string, now = new Date()) {
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { throw new ValidationError("Your display/profile timezone is invalid; configure it before scanning."); }
  const parts = formatter.formatToParts(now);
  const value = (kind: string) => parts.find(part => part.type === kind)!.value;
  const endDate = `${value("year")}-${value("month")}-${value("day")}`;
  const end = new Date(`${endDate}T00:00:00Z`), start = new Date(end);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - options.lookbackMonths);
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(end.getUTCDate(), lastDay));
  return { startDate: start.toISOString().slice(0, 10), endDate };
}
export function patternGroupKey(source: Transaction) {
  const currency = source.currency && /^[A-Z]{3}$/.test(source.currency) ? source.currency : "";
  return JSON.stringify([source.merchantId?.toLowerCase() ?? source.name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20), source.type, currency]);
}
function relativeDeviation(values: Decimal[], mean: Decimal) {
  if (mean.isZero()) return 0;
  return values.reduce((sum, value) => sum.plus(value.minus(mean).div(mean).times(100).pow(2)), new Decimal(0))
    .div(values.length).sqrt().toNumber(); // Dimensionless statistic, never a monetary amount.
}
function modalDay(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const best = Array.from(counts).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best && best[1] >= values.length * 0.6 ? best[0] : undefined;
}
export function inferPatternCalendar(sourceDates: string[]) {
  const dates = sourceDates.map(date => new Date(`${date}T00:00:00Z`));
  const anchor = dates.reduce((maximum, date) => Math.max(maximum, date.getUTCDate()), 1);
  const calendarAnchor = dates.every(date => date.getUTCDate() === Math.min(anchor, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
  return { dayOfMonth: calendarAnchor ? anchor : modalDay(dates.map(date => date.getUTCDate())),
    dayOfWeek: modalDay(dates.map(date => date.getUTCDay())) };
}
export async function readSignedPatterns(
  tx: TransactionType, actor: HouseholdContext, options: PatternOptions,
  window: { startDate: string; endDate: string },
) {
  const sources = await transactionQueryRepository.findForPatternDetection(actor.householdId, { ...options, ...window }, actor, tx);
  const accountIds = Array.from(new Set(sources.map(source => source.accountId)));
  const sourceAccounts = accountIds.length ? await tx.select().from(accounts).where(and(inArray(accounts.id, accountIds), visibleAccountPredicate(actor))) : [];
  const byAccount = new Map(sourceAccounts.map(account => [account.id, account]));
  const [household] = await tx.select().from(households).where(eq(households.id, actor.householdId));
  if (!household) throw new NotFoundError("Recurring pattern");
  const clock = await readPatternTimezone(tx, actor.userId);
  const groups = new Map<string, Transaction[]>();
  for (const source of sources) {
    const key = patternGroupKey(source);
    const group = groups.get(key);
    if (group) group.push(source);
    else groups.set(key, [source]);
  }
  const result: { pattern: SignedPattern; sources: Transaction[] }[] = [];
  for (const [groupKey, rows] of Array.from(groups)) {
    if (rows.length < options.minOccurrences) continue;
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const intervals = sorted.slice(1).map((source, index) => (Date.parse(`${source.date}T00:00:00Z`) - Date.parse(`${sorted[index].date}T00:00:00Z`)) / 86_400_000);
    const intervalMean = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const frequency = ([['daily', 1, 0.5], ['weekly', 7, 2], ['biweekly', 14, 3], ['monthly', 30, 5], ['quarterly', 90, 10], ['yearly', 365, 30]] as const)
      .find(([, days, tolerance]) => Math.abs(intervalMean - days) <= tolerance)?.[0];
    if (!frequency) continue;
    const values = sorted.map(source => new Decimal(source.amount).abs());
    const mean = values.reduce((sum, amount) => sum.plus(amount), new Decimal(0)).div(values.length);
    if (!mean.isPositive()) continue;
    const amountVariance = relativeDeviation(values, mean);
    const intervalVariance = relativeDeviation(intervals.map(interval => new Decimal(interval)), new Decimal(intervalMean));
    const confidence = Math.round(Math.min(25, sorted.length * 5) + Math.max(0, 35 - intervalVariance * 2) + Math.max(0, 30 - amountVariance * 3) + (sorted.length >= 3 ? 10 : 5));
    if (confidence < options.confidenceThreshold) continue;
    const { dayOfMonth, dayOfWeek } = inferPatternCalendar(sorted.map(source => source.date));
    const currency = sorted[0].currency && /^[A-Z]{3}$/.test(sorted[0].currency) ? sorted[0].currency : "";
    const supported = currency === "ZMW" && household.currency === "ZMW" && sorted.every(source => byAccount.get(source.accountId)?.currency === "ZMW");
    const amountTolerance = Math.min(50, Math.max(0, Math.round(amountVariance)));
    const pattern: SignedPattern = {
      name: sorted[0].name, type: sorted[0].type as "income" | "expense", merchantId: sorted[0].merchantId,
      estimatedAmount: new Money(mean, currency).toString(), currency, amountVariance, amountTolerance,
      frequency, dayOfMonth, dayOfWeek, confidence, occurrences: sorted.length,
      sampleTransactionIds: sorted.slice(-5).map(source => source.id), suggestedStartDate: sorted[0].date,
      suggestedNextDueDate: recurringRepository.calculateNextDate(sorted[sorted.length - 1].date, frequency as Frequency, { dayOfMonth, dayOfWeek }),
      ...(!supported ? { confirmationIssue: denominationIssue } : {}),
    };
    if (sorted.length > MAX_PATTERN_CONTRIBUTORS) pattern.confirmationIssue = "This complete group is too large to confirm. Scan a shorter lookback window.";
    else {
      const identity = sorted.map(source => ({
        id: source.id, name: source.name, date: source.date, amount: new Decimal(source.amount).toString(), type: source.type,
        currency: source.currency, accountId: source.accountId, merchantId: source.merchantId, categoryId: source.categoryId,
        ownerUserId: source.ownerUserId, isPrivate: source.isPrivate,
        accountCurrency: byAccount.get(source.accountId)?.currency ?? null,
        accountOwnerUserId: byAccount.get(source.accountId)?.ownerUserId ?? null,
        accountIsPrivate: byAccount.get(source.accountId)?.isPrivate ?? null,
      }));
      const fingerprint = createHash("sha256").update(JSON.stringify({ groupKey, options, ...window, householdCurrency: household.currency, ...clock, identity })).digest("hex");
      pattern.selection = { version: 1, groupKey, options, ...window, ...clock, contributorIds: sorted.map(source => source.id), fingerprint };
    }
    result.push({ pattern, sources: sorted });
  }
  return result.sort((a, b) => b.pattern.confidence - a.pattern.confidence || patternGroupKey(a.sources[0]).localeCompare(patternGroupKey(b.sources[0])));
}
export async function detectVisiblePatterns(householdId: string, rawOptions: unknown, actor: HouseholdContext) {
  if (householdId !== actor.householdId) throw new NotFoundError("Recurring pattern");
  const options = patternOptionsSchema.parse(rawOptions ?? {});
  return db.transaction(async tx => {
    const clock = await readPatternTimezone(tx, actor.userId);
    const window = resolvePatternWindow(options, clock.timezone);
    return (await readSignedPatterns(tx, actor, options, window)).map(({ pattern }) => pattern);
  }, { isolationLevel: "serializable", accessMode: "read only" });
}
