import { afterEach, describe, expect, it, vi } from "vitest";

const createTransportMock = vi.hoisted(() => vi.fn());
const sendMailMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock,
  },
  createTransport: createTransportMock,
}));

vi.mock("../../utils/logger", () => ({
  logger: loggerMock,
}));

const SMTP_ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_FROM_NAME",
  "SMTP_PORT",
  "SMTP_SECURE",
] as const;

const originalEnv = { ...process.env };

async function loadEmailService(
  environment: string,
  envOverrides: Partial<Record<(typeof SMTP_ENV_KEYS)[number], string>> = {},
) {
  vi.resetModules();
  vi.clearAllMocks();

  process.env.NODE_ENV = environment;
  for (const key of SMTP_ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, envOverrides);

  return import("../emailService");
}

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("emailService SMTP configuration guard", () => {
  it.each(["test", "development"])(
    "no-ops with a false result when SMTP is missing in %s",
    async (environment) => {
      const { isEmailServiceConfigured, sendEmail } =
        await loadEmailService(environment);

      expect(isEmailServiceConfigured()).toBe(false);
      await expect(
        sendEmail({
          to: "person@example.com",
          subject: "No SMTP",
          html: "<p>Body</p>",
        }),
      ).resolves.toBe(false);

      expect(createTransportMock).not.toHaveBeenCalled();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        "SMTP not configured, skipping email send",
        { environment },
      );
      expect(loggerMock.error).not.toHaveBeenCalledWith(
        "SMTP not configured in production - email send failed",
      );
    },
  );

  it("fails closed when SMTP is missing in production", async () => {
    const { isEmailServiceConfigured, sendEmail } =
      await loadEmailService("production");

    expect(isEmailServiceConfigured()).toBe(false);
    await expect(
      sendEmail({
        to: "person@example.com",
        subject: "No SMTP",
        html: "<p>Body</p>",
      }),
    ).resolves.toBe(false);

    expect(createTransportMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalledWith(
      "SMTP not configured, skipping email send",
      expect.anything(),
    );
    expect(loggerMock.error).toHaveBeenCalledWith(
      "SMTP not configured in production - email send failed",
    );
  });

  it("sends production email with file and URL access disabled", async () => {
    const { isEmailServiceConfigured, sendEmail } = await loadEmailService(
      "production",
      {
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "smtp-user",
        SMTP_PASS: "smtp-pass",
        SMTP_FROM: "no-reply@example.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
      },
    );
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    sendMailMock.mockResolvedValue({ messageId: "message-1" });

    expect(isEmailServiceConfigured()).toBe(true);
    await expect(
      sendEmail({
        to: "person@example.com",
        subject: "Configured SMTP",
        html: "<p>Body</p>",
      }),
    ).resolves.toBe(true);

    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "smtp-user", pass: "smtp-pass" },
    });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: "Personal Finance App", address: "no-reply@example.com" },
        to: "person@example.com",
        subject: "Configured SMTP",
        html: "<p>Body</p>",
        text: "Body",
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
  });

  const configuredSmtp = {
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "smtp-user",
    SMTP_PASS: "smtp-pass",
    SMTP_FROM: "no-reply@example.com",
  };
  async function sentFrom(fromName?: string): Promise<unknown> {
    const { sendEmail } = await loadEmailService("production",
      fromName === undefined ? configuredSmtp : { ...configuredSmtp, SMTP_FROM_NAME: fromName });
    createTransportMock.mockReturnValue({ sendMail: sendMailMock });
    sendMailMock.mockResolvedValue({ messageId: "message-1" });
    await expect(sendEmail({ to: "person@example.com", subject: "From name", html: "<p>Body</p>" })).resolves.toBe(true);
    return sendMailMock.mock.calls[0][0].from;
  }

  it("uses SMTP_FROM_NAME as the From display name", async () => {
    expect(await sentFrom("Kwacha Ledger")).toEqual({ name: "Kwacha Ledger", address: "no-reply@example.com" });
  });

  it("keeps the current display name when SMTP_FROM_NAME is unset or blank", async () => {
    expect(await sentFrom()).toEqual({ name: "Personal Finance App", address: "no-reply@example.com" });
    expect(await sentFrom("   ")).toEqual({ name: "Personal Finance App", address: "no-reply@example.com" });
  });

  it("never lets SMTP_FROM_NAME add a header line", async () => {
    const from = await sentFrom("Ledger\r\nBcc: someone@example.invalid");

    expect(from).toEqual({ name: "Ledger Bcc: someone@example.invalid", address: "no-reply@example.com" });
  });
});
