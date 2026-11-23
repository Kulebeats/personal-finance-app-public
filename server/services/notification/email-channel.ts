/**
 * E-mail channel for a notification: looks up the recipient, builds the escaped HTML and
 * reports one channel outcome for the delivery ledger.
 */
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import type { NotificationType } from "@shared/notificationTypes";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { sendEmail } from "../emailService";
import { canDispatchBudgetReview } from "../budget/BudgetAlertPublication";
import { buildEmailHtml } from "./email";
import { PRE_DISPATCH_FAILURE, type ChannelResult } from "./delivery";

export async function sendNotificationEmail(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  actionUrl?: string,
  reviewScope?: { householdId: string; year: number; month: number },
  recovery?: { retryBeforeDispatch: boolean; onDispatch?: () => void },
): Promise<ChannelResult> {
  let address: string | null | undefined;
  try {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    address = user?.email;
  } catch (error) {
    if (!recovery?.retryBeforeDispatch) throw error;
    logger.warn("Notification recipient lookup failed before dispatch", { userId, type, error });
    return PRE_DISPATCH_FAILURE;
  }
  if (!address) {
    logger.warn("Cannot send notification email - user email not found", { userId });
    return { status: "suppressed", reason: "no_email" };
  }

  const baseUrl = process.env.APP_URL || "http://localhost:5000";
  const fullActionUrl = actionUrl ? `${baseUrl}${actionUrl}` : null;
  const html = buildEmailHtml(title, body, fullActionUrl);

  let handedOff = false;
  try {
    if (reviewScope && !await canDispatchBudgetReview(userId, reviewScope.householdId, reviewScope.year, reviewScope.month, { channel: "email", address })) {
      return { status: "suppressed", reason: "already_dispatched" };
    }
    recovery?.onDispatch?.();
    handedOff = true;
    const delivered = await sendEmail({
      to: address,
      subject: title,
      html,
      text: `${title}\n\n${body}${fullActionUrl ? `\n\nView: ${fullActionUrl}` : ""}`,
      throwOnUnknownDelivery: true,
    });
    if (!delivered) return { status: "failed", reason: "transport_not_accepted" };
    logger.info("Notification email sent", { userId, type });
    return { status: "sent" };
  } catch (error) {
    logger.error("Failed to send notification email", { userId, type, error });
    if (!handedOff && recovery?.retryBeforeDispatch) return PRE_DISPATCH_FAILURE;
    return { status: "unknown", reason: "transport_threw" };
  }
}
