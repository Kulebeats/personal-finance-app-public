/**
 * Notification Email Templates
 *
 * HTML email templates for notifications.
 *
 * @module services/notification/email
 */

/**
 * Build HTML email for a notification
 */
export function buildEmailHtml(
  title: string,
  body: string,
  actionUrl: string | null
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">${title}</h1>
      </div>
      <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e5e7eb; border-top: none;">
        <p style="margin-top: 0; font-size: 16px;">${body}</p>
        ${
          actionUrl
            ? `
        <div style="text-align: center; margin: 30px 0;">
          <a href="${actionUrl}"
             style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 14px 28px;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 600;
                    display: inline-block;">
            View Details
          </a>
        </div>
        `
            : ""
        }
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
        <p style="font-size: 12px; color: #9ca3af; margin-bottom: 0;">
          You received this email because of your notification preferences.
          <a href="${
            process.env.APP_URL || "http://localhost:5000"
          }/settings/notifications" style="color: #667eea;">
            Manage preferences
          </a>
        </p>
      </div>
    </body>
    </html>
  `;
}
