import nodemailer from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startSmtpSink, type SmtpSink } from "../smtp-sink";
import { extractAuthLink } from "../mail-link";

const ORIGIN = "http://127.0.0.1:5000";
const TOKEN = "a".repeat(64);

let sink: SmtpSink | undefined;
afterEach(async () => { await sink?.close(); sink = undefined; });

/** The same transport shape services/emailService.ts builds from SMTP_* settings. */
function transportTo(port: number) {
  return nodemailer.createTransport({ host: "127.0.0.1", port, secure: false, auth: { user: "sink", pass: "sink" } });
}

describe("AH-03 SMTP sink", () => {
  it("captures a message sent through nodemailer's SMTP transport, link intact", async () => {
    sink = await startSmtpSink();
    const link = `${ORIGIN}/verify-email?token=${TOKEN}`;
    // A long HTML line, so quoted-printable soft breaks land inside the link.
    await transportTo(sink.port).sendMail({
      from: "no-reply@example.test", to: "sink-user@example.invalid", subject: "Verify your email",
      html: `<p>${"padding ".repeat(20)}<a href="${link}">Verify my email</a></p>`, text: `Please verify your email: ${link}`,
    });

    const [mail] = sink.messages();
    expect(sink.messages()).toHaveLength(1);
    expect(mail.to).toEqual(["sink-user@example.invalid"]);
    expect(mail.raw).toContain("Subject: Verify your email");
    expect(mail.raw).toContain("Content-Transfer-Encoding: quoted-printable");
    expect(mail.raw).toContain("token=3D");
    expect(extractAuthLink(mail.raw, ORIGIN, "/verify-email").href).toBe(link);
  });

  it("reads a link from an HTML-only base64 message and refuses a message with two different links", async () => {
    sink = await startSmtpSink();
    const link = `${ORIGIN}/reset-password?token=${TOKEN}`;
    await transportTo(sink.port).sendMail({
      from: "no-reply@example.test", to: "sink-user@example.invalid", subject: "Reset",
      html: `<a href="${link}">Reset Password</a> — é`, textEncoding: "base64",
    });
    await transportTo(sink.port).sendMail({
      from: "no-reply@example.test", to: "sink-user@example.invalid", subject: "Two",
      text: `${link} ${ORIGIN}/reset-password?token=${"b".repeat(64)}`,
    });

    const [reset, two] = sink.messages();
    expect(reset.raw).toContain("Content-Transfer-Encoding: base64");
    expect(reset.raw).not.toContain(link);
    expect(extractAuthLink(reset.raw, ORIGIN, "/reset-password").href).toBe(link);
    expect(() => extractAuthLink(two.raw, ORIGIN, "/reset-password")).toThrow(/exactly one/);
    expect(() => extractAuthLink(reset.raw, ORIGIN, "/verify-email")).toThrow(/found 0/);
  });
});

describe("AH-03 the app's own auth mails through the sink", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it("yields the one link from the real reset and verification mails", async () => {
    sink = await startSmtpSink();
    // As startProfileMailSink sets them; test mode never sends.
    Object.assign(process.env, { NODE_ENV: "development", APP_URL: ORIGIN, SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(sink.port), SMTP_SECURE: "false", SMTP_USER: "sink", SMTP_PASS: "sink", SMTP_FROM: "no-reply@example.test" });
    vi.resetModules();
    const { sendPasswordResetEmail } = await import("../../services/emailService");
    const { authEmailService } = await import("../../modules/auth/auth.email.service");

    expect(await sendPasswordResetEmail("sink-user@example.invalid", TOKEN)).toBe(true);
    const [mail] = sink.messages();
    expect(mail.to).toEqual(["sink-user@example.invalid"]);
    expect(extractAuthLink(mail.raw, ORIGIN, "/reset-password").href).toBe(`${ORIGIN}/reset-password?token=${TOKEN}`);

    await authEmailService.sendVerificationEmail("sink-user@example.invalid", TOKEN);
    expect(sink.messages()).toHaveLength(2);
    expect(extractAuthLink(sink.messages()[1].raw, ORIGIN, "/verify-email").href).toBe(`${ORIGIN}/verify-email?token=${TOKEN}`);
  });
});
