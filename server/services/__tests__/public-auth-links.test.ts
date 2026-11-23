import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
const issue = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({ default: { createTransport: smtp.createTransport } }));
vi.mock("../../utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../security-email", () => ({ issueInitialEmailVerification: issue, consumeEmailVerificationToken: vi.fn() }));

const recipient = "synthetic-links@example.invalid";
const token = "opaque+token/with?query&other=value#fragment\"";
type Payload = { html: string; text: string };
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.assign(process.env, { NODE_ENV: "production", APP_URL: "https://capital.example.invalid/",
    SMTP_HOST: "smtp.example.invalid", SMTP_USER: "synthetic", SMTP_PASS: "synthetic", SMTP_FROM: recipient });
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail });
  smtp.sendMail.mockResolvedValue({ messageId: "synthetic" });
  issue.mockResolvedValue({ email: recipient, token, userId: "synthetic-owner" });
});
afterEach(() => { process.env = { ...originalEnv }; });

async function send(kind: string) {
  const { authEmailService } = await import("../../modules/auth/auth.email.service");
  const mail = await import("../emailService");
  if (kind === "registration") await authEmailService.sendVerificationEmail(recipient, token);
  else if (kind === "public resend") await authEmailService.resendVerification(recipient);
  else if (kind === "email change") await mail.sendVerificationEmail(recipient, token, true);
  else if (kind === "generic verification") await mail.sendVerificationEmail(recipient, token);
  else await mail.sendPasswordResetEmail(recipient, token);
}

describe("public authentication links at the mail transport boundary", () => {
  it.each(["registration", "public resend", "generic verification", "email change", "password reset"])(
    "%s uses the registered root route and preserves one encoded opaque token", async (kind) => {
      await send(kind);
      expect(smtp.sendMail).toHaveBeenCalledTimes(1);
      const payload = smtp.sendMail.mock.calls[0][0] as Payload;
      const path = kind === "password reset" ? "/reset-password" : "/verify-email";
      const expected = new URL(path, process.env.APP_URL);
      expected.searchParams.set("token", token);
      const links = [...payload.html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]).filter((link) => link.includes("token="));
      expect(links.length).toBeGreaterThan(0);
      expect(links.every((link) => link === expected.href)).toBe(true);
      expect(new URL(links[0]).searchParams.get("token")).toBe(token);
      expect([...new URL(links[0]).searchParams.keys()]).toEqual(["token"]);
      expect(new URL(links[0]).hash).toBe("");
      expect(payload.text).toContain(expected.href);
    },
  );

  it.each([undefined, "", "http://capital.example.invalid", "https://user:secret@capital.example.invalid",
    "https://capital.example.invalid/subpath", "https://capital.example.invalid/?other=value",
    "https://capital.example.invalid/#fragment", "javascript:alert(1)", "not an origin"])(
    "never sends a production registration link for an invalid public origin (%s)", async (origin) => {
      if (origin === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = origin;
      await send("registration");
      expect(smtp.sendMail).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid generic mail origin without exposing its value", async () => {
    process.env.APP_URL = "https://user:private-secret@capital.example.invalid";
    await expect(send("email change")).rejects.toEqual(new Error("Invalid public application origin"));
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("retains the documented development fallback", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.APP_URL;
    await send("registration");
    const payload = smtp.sendMail.mock.calls[0][0] as Payload;
    expect(payload.text).toContain("http://localhost:5000/verify-email?token=");
  });
});
