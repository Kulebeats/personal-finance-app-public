import { sql } from "drizzle-orm";
import { accounts, householdMembers, households, netWorthSnapshots, recurringTransactions, userNotificationPreferences, users } from "@shared/schema";
import type { RecurringTransaction } from "@shared/schema";
import type { HouseholdContext } from "../../middleware/householdGuard";
import { readableMembershipPredicate, visibleAccountPredicate } from "../../core/authz/transaction-visibility";
import { visibleRulePredicate } from "../../services/recurring/RecurringAudienceQuery";
import { verifiedRecurringCurrencySql } from "../../services/recurring/RecurringDenomination";
import { ruleNotEndedPredicate } from "../../repositories/RecurringRepository";
import { db } from "../../db";
import { formatCapturedWorth, type CapturedWorthRow } from "./recap-worth.reader";
import { digestSpendingQuery, formatDigestSpending, type DigestSpendGroup } from "./recap-spending.reader";
import type { WeeklyRecapData } from "@shared/weekly-recap";
import type { RecapWeek } from "./recap-week";

type Bill = Pick<RecurringTransaction, "name" | "amount" | "amountType" | "nextDueDate"> & { currency: "ZMW" | null };
export type DigestData = Omit<WeeklyRecapData, "recurring"> & { bills: Bill[] };
type Release = {
  outcome: "ready" | "failed" | "skipped_no_consent" | "skipped_preference";
  worth: CapturedWorthRow[]; visible: string[]; spending: DigestSpendGroup[]; bills: Bill[];
};

/**
 * The transport decision and all outgoing financial data share one SQL statement snapshot.
 * Spending covers `from`..`to`, the week that ended; bills are those due in `content.bills`,
 * the household's next seven dates (A-26).
 */
export async function readDigestRelease(actor: HouseholdContext, email: string, from: string, to: string, currency: string,
  content: { includeRecurring: boolean; bills: RecapWeek }) {
  const result = await db.execute<Release>(sql`
    WITH grant_rows AS (
      SELECT ${households.aiConsentGiven} AS consent, ${userNotificationPreferences.emailEnabled} AS enabled,
        ${users.emailVerified} AS verified, ${users.email} AS email,
        ${households.currency} AS currency
      FROM ${householdMembers}
      JOIN ${households} ON ${households.id} = ${householdMembers.householdId}
      JOIN ${users} ON ${users.id} = ${householdMembers.userId}
      LEFT JOIN ${userNotificationPreferences} ON ${userNotificationPreferences.userId} = ${users.id}
        AND ${userNotificationPreferences.notificationType} = 'weekly_recap'
      WHERE ${householdMembers.householdId} = ${actor.householdId} AND ${householdMembers.userId} = ${actor.userId}
    ), decision AS (
      SELECT CASE WHEN count(*) = 0 OR NOT bool_and(verified IS TRUE AND email = ${email}
        AND ${readableMembershipPredicate(actor)} AND currency IS NOT DISTINCT FROM ${currency})
        THEN 'failed' WHEN NOT bool_and(consent IS TRUE) THEN 'skipped_no_consent'
        WHEN NOT bool_and(enabled IS TRUE) THEN 'skipped_preference' ELSE 'ready' END AS outcome FROM grant_rows
    )
    SELECT outcome,
      CASE WHEN outcome = 'ready' THEN ARRAY(
        SELECT jsonb_build_object('id', ${netWorthSnapshots.id}, 'householdId', ${netWorthSnapshots.householdId},
          'date', ${netWorthSnapshots.date}, 'currency', ${netWorthSnapshots.currency},
          'totalAssets', ${netWorthSnapshots.totalAssets}::text, 'totalLiabilities', ${netWorthSnapshots.totalLiabilities}::text,
          'netWorth', ${netWorthSnapshots.netWorth}::text, 'accountBalances', ${netWorthSnapshots.accountBalances}, 'provenance', ${netWorthSnapshots.provenance})
        FROM ${netWorthSnapshots} WHERE ${netWorthSnapshots.householdId} = ${actor.householdId}
          AND ${netWorthSnapshots.date} BETWEEN ${from}::date - 7 AND ${to}::date ORDER BY ${netWorthSnapshots.date}
      ) END AS worth,
      CASE WHEN outcome = 'ready' THEN ARRAY(SELECT ${accounts.id} FROM ${accounts} WHERE ${visibleAccountPredicate(actor)}) END AS visible,
      CASE WHEN outcome = 'ready' THEN ARRAY(SELECT to_jsonb(spend) FROM (${digestSpendingQuery(actor, from, to, currency)}) spend) END AS spending,
      CASE WHEN outcome = 'ready' THEN ARRAY(
        SELECT jsonb_build_object('name', ${recurringTransactions.name},
          'amount', ${recurringTransactions.amount}::text, 'nextDueDate', ${recurringTransactions.nextDueDate},
          'currency', ${verifiedRecurringCurrencySql()}, 'amountType', ${recurringTransactions.amountType})
        FROM ${recurringTransactions} WHERE ${visibleRulePredicate(actor)}
          AND ${recurringTransactions.type} = 'expense'
          AND ${recurringTransactions.isActive} = true AND ${recurringTransactions.isPaused} = false
          AND ${content.includeRecurring}
          AND ${recurringTransactions.nextDueDate} BETWEEN ${content.bills.from}::date AND ${content.bills.to}::date
          AND ${ruleNotEndedPredicate(content.bills.from)}
        ORDER BY ${recurringTransactions.nextDueDate}, ${recurringTransactions.id}
      ) END AS bills
    FROM decision
  `);
  const row = result.rows[0];
  if (row.outcome !== "ready") return { outcome: row.outcome } as const;
  return { outcome: "ready", data: {
    weekStart: from, weekEnd: to, bills: row.bills,
    netWorth: formatCapturedWorth(row.worth, new Set(row.visible), [{ from, to }])[0],
    spending: formatDigestSpending(row.spending, currency),
  } } as const;
}
