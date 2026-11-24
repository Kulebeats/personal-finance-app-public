/**
 * Weekly Recap Email Service
 *
 * Handles email digest generation and sending for weekly recaps.
 *
 * @module modules/weekly-recap/email-service
 */

import { sendEmail } from "../../services/emailService";
import { and, eq } from "drizzle-orm";
import { householdMembers, households, userNotificationPreferences, users } from "@shared/schema";
import { can } from "../../core/authz/capabilities";
import { Money } from "../../core/money";
import { requireRecapRecipient } from "./weekly-recap.service";
import { logger } from "../../utils/logger";
import { db } from "../../db";
import { withTransaction } from "../../utils/withTransaction";
import { getPostgresError } from "../../utils/postgresError";
import { businessAuditService } from "../../services/BusinessAuditService";
import { effectiveRecapEmail } from "../../repositories/UserNotificationPreferences";
import { readDigestRelease, type DigestData } from "./digest-release";
import { getWeeklyRecapSettings } from "../../repositories/UserDisplayPreferences";
import { previousCompleteWeek, readHouseholdToday, upcomingBillsWindow, type RecapWeek } from "./recap-week";
import { deliverWeeklyRecapOnce, isRecapDay, type RecapSendOutcome } from "./recap-schedule";
import { escapeHtml } from "../../services/notification/escape";

export type { RecapSendOutcome } from "./recap-schedule";

// The shared helper also escapes quotes, which the previous inline version did not.
const htmlText = escapeHtml;

function billAmount(bill: DigestData["bills"][number]): string {
  const raw = htmlText(bill.amount);
  const amount = bill.currency ? `${bill.currency} ${raw}` : `${raw} (currency unrecorded)`;
  if (bill.amountType === "variable") return `Estimated ${amount}`;
  return bill.amountType === "fixed" ? amount : `${amount} (amount type unrecorded)`;
}

function billTotal(bills: DigestData["bills"]): string {
  const currency = bills[0]?.currency;
  if (!currency || bills.some(bill => bill.currency !== currency)) return "Total unavailable because bill currency was not recorded";
  if (bills.some(bill => bill.amountType !== "fixed" && bill.amountType !== "variable")) return "Total unavailable because bill amount type was not recorded";
  const total = bills.reduce((sum, bill) => sum.add(new Money(bill.amount, currency)), Money.zero(currency));
  const label = bills.some(bill => bill.amountType === "variable") ? "Estimated total: " : "";
  return `${label}${currency} ${total.toString()}`;
}

/**
 * Generate HTML email template for weekly recap
 */
function generateEmailTemplate(data: DigestData, currency: string): string {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(amount);
  };

  const formatPercent = (value: number) => {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  };

  const worthCurrency = data.netWorth.currency || currency;
  const formatWorth = (amount: number | string, denomination = worthCurrency) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: denomination, currencyDisplay: "code",
  }).format(typeof amount === "string" ? Number(amount) : amount);
  const previousWorth = data.netWorth.previousMoney
    ? formatWorth(data.netWorth.previousMoney.amount, data.netWorth.previousMoney.currency)
    : data.netWorth.previous === null ? null : formatWorth(data.netWorth.previous);
  const netWorthTrend = (data.netWorth.change ?? 0) >= 0 ? "↑" : "↓";
  const netWorthColor = (data.netWorth.change ?? 0) >= 0 ? "#10b981" : "#f43f5e";
  const spendingTrend = data.spending.changePercent && data.spending.changePercent > 0 ? "↑" : "↓";
  const spendingColor = data.spending.changePercent && data.spending.changePercent > 0 ? "#f43f5e" : "#10b981";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Recap</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9fafb;
    }
    .container {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
      padding-bottom: 20px;
      border-bottom: 2px solid #f97316;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      color: #f97316;
    }
    .header p {
      margin: 8px 0 0 0;
      color: #6b7280;
      font-size: 14px;
    }
    .metric-card {
      background: #f9fafb;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .metric-title {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .metric-value {
      font-size: 32px;
      font-weight: bold;
      margin-bottom: 8px;
    }
    .metric-change {
      font-size: 14px;
      font-weight: 500;
    }
    .category-list {
      list-style: none;
      padding: 0;
      margin: 16px 0 0 0;
    }
    .category-item {
      display: flex;
      justify-content: space-between;
      padding: 12px;
      background: #ffffff;
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .category-name {
      font-weight: 500;
    }
    .category-amount {
      font-weight: 600;
    }
    .bill-list {
      list-style: none;
      padding: 0;
      margin: 16px 0 0 0;
    }
    .bill-item {
      padding: 12px;
      background: #fff7ed;
      border-left: 3px solid #f97316;
      border-radius: 6px;
      margin-bottom: 8px;
    }
    .bill-name {
      font-weight: 500;
      margin-bottom: 4px;
    }
    .bill-details {
      font-size: 13px;
      color: #6b7280;
    }
    .footer {
      text-align: center;
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 13px;
    }
    .cta-button {
      display: inline-block;
      background: #f97316;
      color: #ffffff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: 500;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Weekly Recap</h1>
      <p>${data.weekStart} to ${data.weekEnd}</p>
    </div>

    <div class="metric-card">
      <div class="metric-title">Net Worth</div>
      ${data.netWorth.current === null
        ? '<p>Historical net worth is unavailable</p>'
        : `<div class="metric-value">${formatWorth(data.netWorth.currentMoney?.amount ?? data.netWorth.current, data.netWorth.currentMoney?.currency)}</div>
           ${data.netWorth.asOf ? `<p>Snapshot: ${data.netWorth.asOf} (${worthCurrency})</p>` : ''}
           ${data.netWorth.change === null ? '' :
             `<div class="metric-change" style="color: ${netWorthColor}">${netWorthTrend} ${formatWorth(Math.abs(data.netWorth.change))}
              ${data.netWorth.changePercent === null ? '' : `(${formatPercent(data.netWorth.changePercent)})`}</div>`}`}
      ${data.netWorth.change === null ? `<p>${previousWorth === null ? 'Previous period unavailable' : 'Comparison unavailable'}</p>` : ''}
      ${data.netWorth.change === null && previousWorth !== null ? `<p>Previous snapshot ${data.netWorth.previousAsOf || ''}: ${previousWorth}</p>` : ''}
    </div>

    <div class="metric-card">
      <div class="metric-title">Spending</div>
      <div class="metric-value">${formatCurrency(data.spending.total)}</div>
      ${data.spending.changePercent ? `
        <div class="metric-change" style="color: ${spendingColor}">
          ${spendingTrend} ${formatPercent(data.spending.changePercent)} vs last week
        </div>
      ` : ''}

      ${data.spending.topCategories.length > 0 ? `
        <ul class="category-list">
          ${data.spending.topCategories.slice(0, 3).map(cat => `
            <li class="category-item">
              <span class="category-name">${htmlText(cat.name)}</span>
              <span class="category-amount">${formatCurrency(cat.amount)}</span>
            </li>
          `).join('')}
        </ul>
      ` : '<p style="margin-top: 12px; color: #6b7280;">No spending this week</p>'}
    </div>

    ${data.bills.length > 0 ? `
      <div class="metric-card">
        <div class="metric-title">Upcoming Bills (${data.bills.length})</div>
        <div class="metric-value">${billTotal(data.bills)}</div>
        <ul class="bill-list">
          ${data.bills.slice(0, 3).map(bill => `
            <li class="bill-item">
              <div class="bill-name">${htmlText(bill.name)}</div>
              <div class="bill-details">
                ${billAmount(bill)} • Due ${bill.nextDueDate}
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''}

    <div style="text-align: center;">
      <a href="${process.env.APP_URL || 'http://localhost:5173'}/dashboard" class="cta-button">
        View Full Recap
      </a>
    </div>

    <div class="footer">
      <p>You're receiving this because you've enabled weekly recap emails.</p>
      <p>
        <a href="${process.env.APP_URL || 'http://localhost:5173'}/settings/weekly-recap"
           style="color: #f97316; text-decoration: none;">
          Manage email preferences
        </a>
      </p>
    </div>
  </div>
</body>
</html>
  `;
}

async function readDeliveryGrant(userId: string, householdId: string, email: string) {
  const grants = await db.select({
    role: householdMembers.role, currency: households.currency, consent: households.aiConsentGiven,
    email: users.email, verified: users.emailVerified, emailEnabled: userNotificationPreferences.emailEnabled,
  }).from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .leftJoin(userNotificationPreferences, and(
      eq(userNotificationPreferences.userId, users.id),
      eq(userNotificationPreferences.notificationType, "weekly_recap"),
    ))
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  const recipient = grants[0];
  if (!recipient || !can(recipient.role, "financial.read") || recipient.email !== email) return { outcome: "failed" } as const;
  // OPS-007 P2: not yet deliverable rather than broken; sent once the address is verified.
  if (!recipient.verified) return { outcome: "skipped_unverified" } as const;
  if (!recipient.consent) return { outcome: "skipped_no_consent" } as const;
  if (!effectiveRecapEmail(grants)) return { outcome: "skipped_preference" } as const;
  return { outcome: "ready", role: recipient.role, currency: recipient.currency } as const;
}

/** The digest HTML, or why there is none to send. Nothing has left the server yet. */
async function prepareRecapEmail(
  userId: string, householdId: string, email: string, weekStart: string, weekEnd: string, bills?: RecapWeek,
): Promise<{ outcome: "ready"; html: string } | { outcome: Exclude<RecapSendOutcome, "sent" | "sent_unaudited" | "unknown"> }> {
  try {
    // SCP-319: DPA consent gate. A weekly recap is a financial-PII digest, so it
    // must NEVER be emailed without the household's explicit consent
    // (households.aiConsentGiven, which covers AI + recap egress). Consent
    // defaults to false, so an un-consented household is silently excluded.
    const grant = await readDeliveryGrant(userId, householdId, email);
    if (grant.outcome !== "ready") return { outcome: grant.outcome };
    if (!grant.currency) throw new Error("Missing household currency for recap");
    const actor = await requireRecapRecipient(householdId, userId);
    // OPS-007: excluded upcoming bills are never read for the digest.
    const { includeRecurring } = await getWeeklyRecapSettings(userId);
    const billsWindow = bills ?? { from: weekStart, to: weekEnd };
    const release = await readDigestRelease(actor, email, weekStart, weekEnd, grant.currency, { includeRecurring, bills: billsWindow });
    if (release.outcome !== "ready") return { outcome: release.outcome };
    return { outcome: "ready", html: generateEmailTemplate(release.data, grant.currency) };
  } catch (error) {
    // OPS-007 P2: a database or network error may pass by the next tick; the recap's own data
    // (no currency, a refused recipient, a missing FX rate) will not, so it is not rebuilt that day.
    const transient = getPostgresError(error) !== undefined || typeof (error as { errno?: unknown } | null)?.errno === "number";
    logger.error("Failed to prepare weekly recap email", { userId, transient }, error as Error);
    return { outcome: transient ? "failed" : "unbuildable" };
  }
}

/**
 * Send weekly recap email to a user. Spending covers weekStart..weekEnd; the
 * bills are those due in `bills`, by default the same dates. The scheduled
 * digest passes the household's next seven dates (A-26).
 *
 * OPS-007 P2: only a send SMTP definitely refused is "failed" (retryable). An
 * ambiguous SMTP reply is "unknown" and an audit failure after acceptance is
 * "sent_unaudited"; the ledger never repeats either.
 */
export async function sendWeeklyRecapEmail(
  userId: string,
  householdId: string,
  email: string,
  weekStart: string,
  weekEnd: string,
  bills?: RecapWeek,
): Promise<RecapSendOutcome> {
  const prepared = await prepareRecapEmail(userId, householdId, email, weekStart, weekEnd, bills);
  if (prepared.outcome !== "ready") return prepared.outcome;

  try {
    const sent = await sendEmail({
      to: email,
      subject: `📊 Your Weekly Financial Recap (${weekStart} to ${weekEnd})`,
      html: prepared.html,
      throwOnUnknownDelivery: true,
    });
    if (!sent) return "failed";
  } catch (error) {
    logger.error("Weekly recap email: SMTP acceptance unknown", { userId }, error as Error);
    return "unknown";
  }

  try {
    // SCP-319: DPA audit — record the financial-PII email egress (metadata only,
    // never the recap contents) so each send is traceable. Written through a tx
    // so an insert failure reaches the catch below instead of being swallowed.
    await withTransaction(tx => businessAuditService.log({
      tx,
      userId,
      householdId,
      action: "PROCESS",
      entityType: "data_export",
      entityId: userId,
      details: {
        exportType: "weekly_recap_email",
        weekStart,
        weekEnd,
        recipient: email.substring(0, 3) + "***",
      },
    }));
  } catch (error) {
    // The e-mail left the server: it must not be sent again, but its missing egress row must be seen.
    logger.error("Weekly recap email sent but its egress audit row failed", { userId, weekStart, weekEnd }, error as Error);
    return "sent_unaudited";
  }

  logger.info("Weekly recap email sent", {
    userId: userId.substring(0, 8) + "...",
    email: email.substring(0, 3) + "***",
  });
  return "sent";
}

/**
 * Process weekly recap emails for all users who have it enabled
 */
export async function processWeeklyRecapEmails(
  now: Date = new Date(),
): Promise<{ sent: number; failed: number; skipped: number; unknown: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let unknown = 0;

  try {
    // OPS-007: a user is sent on their chosen day of their household's
    // calendar; the digest covers the complete week that ended the day before.
    logger.info("Weekly recap email job triggered");

    // Query notification preferences to find users with weekly recap email enabled
    const enabledSettings = await db.selectDistinct({ userId: userNotificationPreferences.userId })
      .from(userNotificationPreferences).where(and(
        eq(userNotificationPreferences.notificationType, "weekly_recap"),
        eq(userNotificationPreferences.emailEnabled, true),
      ));

    logger.info("Found users with weekly recap email enabled", {
      count: enabledSettings.length,
    });

    // Send email to each user
    for (const pref of enabledSettings) {
      if (!pref.userId) {
        failed++;
        continue;
      }

      try {
        // Get user details
        const user = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, pref.userId!),
          columns: {
            id: true,
            email: true,
          },
        });

        // OPS-007 P2: a user with no address or no household is not deliverable: a skip, not a failure.
        if (!user || !user.email) {
          logger.warn("User not found or no email", { userId: pref.userId ?? "unknown" });
          skipped++;
          continue;
        }

        // Get household
        const householdMember = await db.query.householdMembers.findFirst({
          where: (members, { eq }) => eq(members.userId, user.id),
          columns: {
            householdId: true,
          },
        });

        if (!householdMember || !householdMember.householdId) {
          logger.warn("User not in household", { userId: user.id });
          skipped++;
          continue;
        }

        const householdId = householdMember.householdId;
        const today = await readHouseholdToday(householdId, now);
        const { dayOfWeek } = await getWeeklyRecapSettings(user.id);
        if (!isRecapDay(today, dayOfWeek)) continue;
        // A-26: spending is the week that ended; bills are the next seven household dates.
        const week = previousCompleteWeek(today, dayOfWeek);
        const address = user.email;
        const outcome = await deliverWeeklyRecapOnce(user.id, today, () => sendWeeklyRecapEmail(
          user.id, householdId, address, week.from, week.to, upcomingBillsWindow(today),
        ));

        if (outcome === "sent") sent++;
        else if (outcome === "sent_unaudited") { sent++; failed++; }
        else if (outcome === "skipped") skipped++;
        else if (outcome === "unknown") unknown++;
        else if (outcome === "failed") failed++;
      } catch (error) {
        logger.error("Failed to send email to user", { userId: pref.userId ?? "unknown" }, error as Error);
        failed++;
      }
    }

    logger.info("Weekly recap email job completed", { sent, failed, skipped, unknown });
  } catch (error) {
    logger.error("Weekly recap email job failed", {}, error as Error);
  }

  return { sent, failed, skipped, unknown };
}
