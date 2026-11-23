/**
 * Emailed links must land on a real client route.
 *
 * The verification email linked to /auth/verify-email, but the client only
 * serves /verify-email, so the link opened the NotFound page. The client
 * routes are read from client/src/App.tsx so this fails if either side drifts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  findByEmail: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/emailService", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("../repositories/UserRepository", () => ({
  userRepository: { findByEmail: mocks.findByEmail, update: mocks.update },
}));
vi.mock("../services/AuditService", () => ({
  auditService: { log: vi.fn() },
  AuditEventType: {},
}));
vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../repositories/NotificationRepository", () => ({
  notificationRepository: {},
}));
vi.mock("../services/notification/push", () => ({
  pushNotificationService: {},
}));
// The resend path issues its token inside a locked transaction here; this
// test only checks the emailed link, so the issuer is stubbed.
vi.mock("../services/security-email", () => ({
  issueInitialEmailVerification: vi.fn().mockResolvedValue({
    userId: "u1",
    email: "a@example.com",
    token: "tok",
  }),
  consumeEmailVerificationToken: vi.fn(),
}));

import { authEmailService } from "../modules/auth/auth.email.service";
import { notificationService } from "../services/notification/service";

const APP_PATH = path.resolve(__dirname, "../../client/src/App.tsx");

function clientRoutePatterns(): RegExp[] {
  const source = readFileSync(APP_PATH, "utf8");
  const paths = [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map(
    (match) => match[1],
  );
  return paths.map(
    (routePath) => new RegExp(`^${routePath.replace(/:[^/]+/g, "[^/]+")}$`),
  );
}

function matchesClientRoute(urlOrPath: string): boolean {
  const { pathname } = new URL(urlOrPath, "http://app.test");
  return clientRoutePatterns().some((pattern) => pattern.test(pathname));
}

function sentLink(): string {
  const { text } = mocks.sendEmail.mock.calls[0][0] as { text: string };
  const link = text.match(/https?:\/\/\S+/);
  if (!link) throw new Error(`no link in email text: ${text}`);
  return link[0];
}

describe("emailed links resolve to client routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "http://app.test";
  });

  it("registration verification email links to a client route", async () => {
    await authEmailService.sendVerificationEmail("a@example.com", "tok");

    expect(sentLink()).toContain("?token=tok");
    expect(matchesClientRoute(sentLink())).toBe(true);
  });

  it("resent verification email links to a client route", async () => {
    mocks.findByEmail.mockResolvedValue({ id: "u1", emailVerified: false });

    await authEmailService.resendVerification("a@example.com");

    expect(matchesClientRoute(sentLink())).toBe(true);
  });

  it("large-transaction notification action URL is a client route", async () => {
    const notify = vi
      .spyOn(notificationService, "notify")
      .mockResolvedValue(null as never);
    vi.spyOn(notificationService, "getUserPreferences").mockResolvedValue(
      null as never,
    );

    await notificationService.triggerLargeTransaction(
      "u1",
      "h1",
      "tx-1",
      1000,
      "Shop",
    );

    const data = notify.mock.calls[0][3] as { actionUrl: string };
    expect(matchesClientRoute(data.actionUrl)).toBe(true);
  });
});
