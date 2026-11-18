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
        from: '"Personal Finance App" <no-reply@example.com>',
        to: "person@example.com",
        subject: "Configured SMTP",
        html: "<p>Body</p>",
        text: "Body",
        disableFileAccess: true,
        disableUrlAccess: true,
      }),
    );
  });
});
