/**
 * Household invitation e-mail HTML. Every value is user- or caller-controlled text (names,
 * the invitee's address, the accept link), so each goes through the one shared escapeHtml.
 */
import { escapeHtml } from "../../services/notification/escape";

export function buildInvitationEmailTemplate(params: {
  inviterName: string;
  householdName: string;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
  recipientEmail: string;
}): string {
  const { inviterName, householdName, role, inviteUrl, expiresAt, recipientEmail } = params;
  const expiresOn = expiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const safeInviter = escapeHtml(inviterName);
  const safeHousehold = escapeHtml(householdName);
  const safeRole = escapeHtml(role.replace("_", " "));
  const safeUrl = escapeHtml(inviteUrl);
  const safeRecipient = escapeHtml(recipientEmail);

  return `
  <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="margin-bottom: 8px;">Household Invitation</h1>
      <p><strong>${safeInviter}</strong> invited you to join <strong>${safeHousehold}</strong> as <strong>${safeRole}</strong>.</p>
      <p>This invitation expires on <strong>${escapeHtml(expiresOn)}</strong>.</p>
      <p style="margin: 24px 0;">
        <a href="${safeUrl}" style="display: inline-block; background: #f97316; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 6px; font-weight: 600;">Accept Invitation</a>
      </p>
      <p>If the button does not work, open this link:</p>
      <p><a href="${safeUrl}" style="word-break: break-all;">${safeUrl}</a></p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
      <p style="font-size: 12px; color: #6b7280;">This invitation was sent to ${safeRecipient}.</p>
    </body>
  </html>
  `;
}
