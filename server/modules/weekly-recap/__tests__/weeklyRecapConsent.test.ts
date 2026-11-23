/**
 * SCP-319: weekly-recap email must be DPA-gated + audited — REAL DB.
 *
 * processWeeklyRecapEmails previously emailed a financial-PII digest to every
 * email-enabled user with NO consent gate and NO audit row. The fix gates each
 * send on households.aiConsentGiven and writes a data_export egress audit row on
 * every successful send.
 *
 * Only the SMTP boundary (sendEmail) is mocked; the consent gate, audit write,
 * and recap generation run against real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import { accounts, auditLogs, users, households, householdMembers, userNotificationPreferences } from "@shared/schema";
import { sendEmail } from "../../../services/emailService";
import { sendWeeklyRecapEmail } from "../weekly-recap.email.service";
import {
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";

// Mock only the SMTP boundary; everything else is real.
vi.mock("../../../services/emailService", () => ({
  sendEmail: vi.fn(),
}));

const sendEmailMock = vi.mocked(sendEmail);

describe("weekly-recap consent gate + audit (SCP-319)", () => {
  let householdId: string;
  let userId: string;
  let email: string;

  const auditRowsForHousehold = async () =>
    (await db.select().from(auditLogs).where(eq(auditLogs.householdId, householdId)))
      .filter(
        (row) =>
          row.entityType === "data_export" &&
          (row.details as Record<string, unknown> | null)?.exportType ===
            "weekly_recap_email",
      );

  beforeAll(async () => {
    const stamp = Date.now();
    const user = createTestUser({
      email: `scp319-${stamp}@example.com`,
      username: `scp319-${stamp}`,
    });
    email = user.email;
    const hh = createTestHousehold(user.id, { name: `scp319-${stamp}` });
    householdId = hh.id;
    userId = user.id;

    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
      // aiConsentGiven defaults to false — the un-consented starting state.
    });
    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    await db.insert(userNotificationPreferences).values({ userId, notificationType: "weekly_recap", emailEnabled: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.insert(accounts).values({
      id: randomUUID(),
      householdId,
      name: "scp319-checking",
      type: "checking",
      balance: "1000.00",
      currency: "ZMW",
    });
  });

  afterAll(async () => {
    try {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-319 cleanup error", error);
    }
  });

  beforeEach(() => {
    sendEmailMock.mockReset();
  });

  it("does NOT send and writes NO audit row without consent", async () => {
    // Household starts with aiConsentGiven = false (default).
    const outcome = await sendWeeklyRecapEmail(
      userId,
      householdId,
      email,
      "2026-01-05",
      "2026-01-11",
    );

    expect(outcome).toBe("skipped_no_consent");
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await auditRowsForHousehold()).toHaveLength(0);
  });

  it("sends and writes exactly one audit row once consent is given", async () => {
    await db
      .update(households)
      .set({ aiConsentGiven: true })
      .where(eq(households.id, householdId));
    sendEmailMock.mockResolvedValue(true);

    const outcome = await sendWeeklyRecapEmail(
      userId,
      householdId,
      email,
      "2026-01-05",
      "2026-01-11",
    );

    expect(outcome).toBe("sent");
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const rows = await auditRowsForHousehold();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].action).toBe("PROCESS");
    // The audit records metadata only — never the recap contents.
    const details = rows[0].details as Record<string, unknown>;
    expect(details.exportType).toBe("weekly_recap_email");
    expect(String(details.recipient)).not.toContain("@");
  });

  it("does NOT add an audit row when the email send fails", async () => {
    // Consent is granted (from the previous test) but SMTP fails.
    sendEmailMock.mockResolvedValue(false);

    const outcome = await sendWeeklyRecapEmail(
      userId,
      householdId,
      email,
      "2026-01-05",
      "2026-01-11",
    );

    expect(outcome).toBe("failed");
    // Still exactly the one row from the successful send — no row on failure.
    expect(await auditRowsForHousehold()).toHaveLength(1);
  });
});
