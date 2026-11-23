/**
 * OPS-009: every e-mail template escapes user-controlled values through the one shared helper,
 * and a subject cannot carry a line break. Templates are rendered by the real functions; only
 * the SMTP transport (nodemailer) is stubbed so the sent HTML can be read.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { buildInvitationEmailTemplate } from "../../modules/household/invitations.email-template";
import { buildEmailHtml } from "../notification/email";

const HOSTILE = `<img src=x onerror=alert(1)> & "quoted"`;
const ESCAPED = "&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;";

function expectEscaped(html: string) {
  expect(html).toContain(ESCAPED);
  expect(html).not.toContain("<img");
  expect(html).not.toContain(`"quoted"`);
}

describe("OPS-009 e-mail template escaping", () => {
  it("escapes the household invitation (names, role, recipient and link)", () => {
    const html = buildInvitationEmailTemplate({
      inviterName: HOSTILE,
      householdName: HOSTILE,
      role: "view_only",
      inviteUrl: `https://app.example.test/invite?token=a"><b>x</b>&y=1`,
      expiresAt: new Date("2026-12-01T00:00:00Z"),
      recipientEmail: `"><script>alert(1)</script>@example.test`,
    });

    expectEscaped(html);
    expect(html).toContain("view only");
    expect(html).toContain(`href="https://app.example.test/invite?token=a&quot;&gt;&lt;b&gt;x&lt;/b&gt;&amp;y=1"`);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
  });

  it("escapes the notification e-mail (title, body, button label and link)", () => {
    const html = buildEmailHtml(HOSTILE, HOSTILE, `https://app.example.test/x?a="1"&b=2`, { buttonLabel: HOSTILE });

    expectEscaped(html);
    expect(html).toContain(`href="https://app.example.test/x?a=&quot;1&quot;&amp;b=2"`);
  });

  describe("emailService templates (SMTP stubbed)", () => {
    const original = { env: process.env.NODE_ENV, host: process.env.SMTP_HOST, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM };
    let service: typeof import("../emailService");

    beforeAll(async () => {
      process.env.NODE_ENV = "development"; // the test environment disables SMTP entirely
      process.env.SMTP_HOST = "smtp.example.test";
      process.env.SMTP_USER = "user";
      process.env.SMTP_PASS = "pass";
      process.env.SMTP_FROM = "no-reply@example.test";
      service = await import("../emailService");
    });

    beforeEach(() => sendMail.mockClear());

    afterAll(() => {
      process.env.NODE_ENV = original.env;
      for (const [name, value] of [["SMTP_HOST", original.host], ["SMTP_USER", original.user], ["SMTP_PASS", original.pass], ["SMTP_FROM", original.from]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    const sentHtml = () => String(sendMail.mock.calls[0][0].html);

    it("escapes the MFA code e-mail (recipient name and code)", async () => {
      await service.sendMfaCodeEmail("user@example.test", HOSTILE, HOSTILE);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expectEscaped(sentHtml());
    });

    it("escapes the verification e-mail link", async () => {
      await service.sendVerificationEmail("user@example.test", `a"><img src=x onerror=alert(1)>`);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sentHtml()).not.toContain("<img");
      expect(sentHtml()).not.toMatch(/href="[^"]*"[^>]*"[^>]*>\s*<img/);
    });

    it("escapes the password reset e-mail link", async () => {
      await service.sendPasswordResetEmail("user@example.test", `a"><img src=x onerror=alert(1)>`);

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sentHtml()).not.toContain("<img");
    });

    it("keeps a line break out of the subject", async () => {
      await service.sendEmail({ to: "user@example.test", subject: "Invitation to join Home\r\nBcc: attacker@example.test", html: "<p>x</p>" });

      const subject = String(sendMail.mock.calls[0][0].subject);
      expect(subject).not.toMatch(/[\r\n]/);
      expect(subject).toBe("Invitation to join Home Bcc: attacker@example.test");
    });
  });
});
