import nodemailer from "nodemailer";
import { afterEach, describe, expect, it } from "vitest";
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
