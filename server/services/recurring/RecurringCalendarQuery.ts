import { and, between, eq, sql } from "drizzle-orm";
import { recurringTransactionHistory, recurringTransactionLinks, recurringTransactions, transactions } from "@shared/schema";
import type { CalendarDateRange } from "@shared/household-calendar";
import { isCanonicalImportDate } from "@shared/import-date";
import { visibleTransactionPredicate } from "../../core/authz/transaction-visibility";
import { amountInUnit, type AmountInUnitDto } from "../../core/money";
import { db } from "../../db";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { postedTransactionPredicate } from "../../repositories/postedTransactionPredicate";
import { ruleNotEndedPredicate } from "../../repositories/RecurringRepository";
import { householdToday } from "../householdCalendarToday";
import { visibleRulePredicate } from "./RecurringAudienceQuery";
import { verifiedRecurringCurrencySql, withRecurringDefinitionMetadata, type VisibleRecurringRule } from "./RecurringDenomination";

type Status = "upcoming" | "due" | "overdue" | "pending" | "paid" | "received" | "skipped";
type RuleRow = { rule: typeof recurringTransactions.$inferSelect; currency: "ZMW" | null };

interface Occurrence {
  id: string;
  date: string;
  status: Status;
  rule: VisibleRecurringRule;
  amount: AmountInUnitDto | null;
}

const occurrenceId = (ruleId: string, date: string) => `${ruleId}:${date}`;

export async function listRecurringCalendar(actor: HouseholdContext, { from, to }: CalendarDateRange) {
  return db.transaction(async tx => {
    const today = await householdToday(tx, actor.householdId);
    const visible = visibleRulePredicate(actor);
    const ruleFields = { rule: recurringTransactions, currency: verifiedRecurringCurrencySql() };
    const links = recurringTransactionLinks;
    const history = recurringTransactionHistory;
    const skippedDate = sql<string>`${history.previousState}->>'nextDueDate'`;

    const scheduled = await tx.select(ruleFields).from(recurringTransactions).where(and(
      visible, eq(recurringTransactions.isActive, true), eq(recurringTransactions.isPaused, false),
      ruleNotEndedPredicate(today), between(recurringTransactions.nextDueDate, from, to),
    ));
    const linked = await tx.select({
      ...ruleFields, date: sql<string>`${links.expectedDate}`,
      amount: transactions.amount, transactionCurrency: transactions.currency,
      posted: sql<boolean>`(${postedTransactionPredicate})`,
    }).from(recurringTransactions)
      .innerJoin(links, and(eq(links.recurringTransactionId, recurringTransactions.id),
        eq(links.status, "linked"), between(links.expectedDate, from, to)))
      .innerJoin(transactions, and(eq(transactions.id, links.transactionId),
        eq(transactions.type, recurringTransactions.type), visibleTransactionPredicate(actor)))
      .where(visible);
    const skipped = await tx.select({ ...ruleFields, date: skippedDate }).from(recurringTransactions)
      .innerJoin(history, and(eq(history.recurringTransactionId, recurringTransactions.id),
        eq(history.action, "skipped"), between(skippedDate, from, to))).where(visible);

    const occurrences = new Map<string, Occurrence>();
    const record = ({ rule, currency }: RuleRow, date: string, status: Status, amount: Occurrence["amount"]) => {
      const id = occurrenceId(rule.id, date);
      occurrences.set(id, { id, date, status, rule: withRecurringDefinitionMetadata(rule, currency), amount });
    };

    for (const row of skipped) {
      if (isCanonicalImportDate(row.date)) record(row, row.date, "skipped", null);
    }
    for (const row of scheduled) {
      const date = row.rule.nextDueDate;
      const status = date < today ? "overdue" : date === today ? "due" : "upcoming";
      record(row, date, status, amountInUnit(row.rule.amount, row.currency));
    }
    for (const row of linked) {
      const { date, rule, posted, amount, transactionCurrency } = row;
      const previous = occurrences.get(occurrenceId(rule.id, date));
      if (!posted && (previous?.status === "paid" || previous?.status === "received")) continue;
      const status = posted ? (rule.type === "income" ? "received" : "paid") : "pending";
      // More than one payment of the same precedence leaves no single amount to display.
      record(row, date, status, previous?.status === status ? null : amountInUnit(amount, transactionCurrency));
    }
    return Array.from(occurrences.values()).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
