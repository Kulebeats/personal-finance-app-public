/**
 * Weekly Recap Email Service
 *
 * Handles email digest generation and sending for weekly recaps.
 *
 * @module modules/weekly-recap/email-service
 */

import { sendEmail } from "../../services/emailService";
import { weeklyRecapService } from "./weekly-recap.service";
import { logger } from "../../utils/logger";
import type { WeeklyRecapData } from "@shared/weekly-recap";
import { db } from "../../db";
import { businessAuditService } from "../../services/BusinessAuditService";

/** Outcome of attempting to send one weekly-recap digest. */
export type RecapSendOutcome = "sent" | "skipped_no_consent" | "failed";

/**
 * Generate HTML email template for weekly recap
 */
function generateEmailTemplate(data: WeeklyRecapData, currency: string): string {
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

  const netWorthTrend = data.netWorth.change >= 0 ? "↑" : "↓";
  const netWorthColor = data.netWorth.change >= 0 ? "#10b981" : "#f43f5e";
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
      <div class="metric-value">${formatCurrency(data.netWorth.current)}</div>
      <div class="metric-change" style="color: ${netWorthColor}">
        ${netWorthTrend} ${formatCurrency(Math.abs(data.netWorth.change))}
        (${formatPercent(data.netWorth.changePercent)})
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-title">Spending</div>
      <div class="metric-value">${formatCurrency(data.spending.total)}</div>
      ${data.spending.changePercent ? `
        <div class="metric-change" style="color: ${spendingColor}">
          ${spendingTrend} ${formatPercent(Math.abs(data.spending.changePercent))} vs last week
        </div>
      ` : ''}

      ${data.spending.topCategories.length > 0 ? `
        <ul class="category-list">
          ${data.spending.topCategories.slice(0, 3).map(cat => `
            <li class="category-item">
              <span class="category-name">${cat.name}</span>
              <span class="category-amount">${formatCurrency(cat.amount)}</span>
            </li>
          `).join('')}
        </ul>
      ` : '<p style="margin-top: 12px; color: #6b7280;">No spending this week</p>'}
    </div>

    ${data.recurring.upcoming.length > 0 ? `
      <div class="metric-card">
        <div class="metric-title">Upcoming Bills (${data.recurring.count})</div>
        <div class="metric-value">${formatCurrency(data.recurring.totalAmount)}</div>
        <ul class="bill-list">
          ${data.recurring.upcoming.slice(0, 3).map(bill => `
            <li class="bill-item">
              <div class="bill-name">${bill.name}</div>
              <div class="bill-details">
                ${formatCurrency(bill.amount)} • Due ${bill.dueDate}
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

/**
 * Send weekly recap email to a user
 */
export async function sendWeeklyRecapEmail(
  userId: string,
  householdId: string,
  email: string,
  weekStart: string,
  weekEnd: string
): Promise<RecapSendOutcome> {
  try {
    // SCP-319: DPA consent gate. A weekly recap is a financial-PII digest, so it
    // must NEVER be emailed without the household's explicit consent
    // (households.aiConsentGiven, which covers AI + recap egress). Consent
    // defaults to false, so an un-consented household is silently excluded.
    const household = await db.query.households.findFirst({
      where: (h, { eq }) => eq(h.id, householdId),
      columns: { aiConsentGiven: true },
    });

    if (!household?.aiConsentGiven) {
      logger.info("Weekly recap skipped — DPA consent not given", {
        userId: userId.substring(0, 8) + "...",
        householdId,
      });
      return "skipped_no_consent";
    }

    // Get user settings for currency
    const settings = await db.query.userDisplaySettings.findFirst({
      where: (settings, { eq }) => eq(settings.userId, userId),
    });

    const currency = settings?.currency || "ZMW";

    // Generate recap data
    const recapData = await weeklyRecapService.getRecap(
      householdId,
      userId,
      weekStart,
      weekEnd
    );

    // Generate email HTML
    const html = generateEmailTemplate(recapData, currency);

    // Send email
    const sent = await sendEmail({
      to: email,
      subject: `📊 Your Weekly Financial Recap (${weekStart} to ${weekEnd})`,
      html,
    });

    if (!sent) {
      return "failed";
    }

    // SCP-319: DPA audit — record the financial-PII email egress (metadata only,
    // never the recap contents) so each send is traceable.
    await businessAuditService.log({
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
    });

    logger.info("Weekly recap email sent", {
      userId: userId.substring(0, 8) + "...",
      email: email.substring(0, 3) + "***",
    });

    return "sent";
  } catch (error) {
    logger.error("Failed to send weekly recap email", { userId }, error as Error);
    return "failed";
  }
}

/**
 * Process weekly recap emails for all users who have it enabled
 */
export async function processWeeklyRecapEmails(
  dayOfWeek: number
): Promise<{ sent: number; failed: number; skipped: number }> {
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  try {
    // Calculate current week dates based on the specified day of week
    const now = new Date();
    const currentDay = now.getDay();

    // Calculate offset to get to the start of the week (assuming week starts on specified day)
    let offset = currentDay - dayOfWeek;
    if (offset < 0) offset += 7;

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - offset - 7); // Previous week
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    logger.info("Weekly recap email job triggered", {
      dayOfWeek,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
    });

    // Query notification preferences to find users with weekly recap email enabled
    const enabledSettings = await db.query.userNotificationPreferences.findMany({
      where: (prefs, { and, eq }) =>
        and(
          eq(prefs.notificationType, "weekly_recap"),
          eq(prefs.emailEnabled, true)
        ),
    });

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

        if (!user || !user.email) {
          logger.warn("User not found or no email", { userId: pref.userId ?? "unknown" });
          failed++;
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
          failed++;
          continue;
        }

        const outcome = await sendWeeklyRecapEmail(
          user.id,
          householdMember.householdId,
          user.email,
          weekStartStr,
          weekEndStr
        );

        if (outcome === "sent") {
          sent++;
        } else if (outcome === "skipped_no_consent") {
          skipped++;
        } else {
          failed++;
        }
      } catch (error) {
        logger.error("Failed to send email to user", { userId: pref.userId ?? "unknown" }, error as Error);
        failed++;
      }
    }

    logger.info("Weekly recap email job completed", { sent, failed, skipped });
  } catch (error) {
    logger.error("Weekly recap email job failed", {}, error as Error);
  }

  return { sent, failed, skipped };
}
