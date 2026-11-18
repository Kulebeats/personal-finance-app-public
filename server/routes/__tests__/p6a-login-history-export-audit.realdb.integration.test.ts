/**
 * Packet P6a (DPA audit edges): login-history export must be audited — REAL DB.
 *
 * Audit finding (production-readiness-audit-v2-2026-07-11.md): GET
 * /api/settings/security/sessions/login-history/export egresses PII (IP
 * addresses, device names, approximate location) as a downloadable CSV/JSON
 * file with NO audit row at all — a Zambia DPA gap on financial-account
 * security data. The fix mirrors the existing PROCESS/data_export pattern
 * used by the reports CSV export and the ZRA tax export (server/routes/
 * investment-tax.ts): a fresh id identifies the single-shot egress event,
 * metadata only (never the exported rows), householdId is null because
 * login history is a user-level security record, not household-scoped.
 *
 * @module routes/__tests__/p6a-login-history-export-audit.realdb.integration.test
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { users, households, householdMembers, userLoginHistory, auditLogs } from "@shared/schema";
import { getTestApp, createTestUser, createTestHousehold } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";

describe("Login-history export writes a DPA audit row (P6a) — REAL DB", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `p6a-login-hist-${timestamp}@example.com`,
      username: `p6a-lh-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "P6a Login History Household",
      currency: "ZMW",
    });
    testUser.passwordHash = await hashPassword("TestPassword123");
    householdId = testHousehold.id;
    userId = testUser.id;
    testUser.householdId = testHousehold.id;

    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });
    await db.insert(users).values({
      id: testUser.id,
      email: testUser.email,
      username: testUser.username,
      passwordHash: testUser.passwordHash,
      fullName: testUser.fullName,
      emailVerified: testUser.emailVerified,
      mfaEnabled: testUser.mfaEnabled,
      failedLoginAttempts: testUser.failedLoginAttempts,
      lockedUntil: testUser.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: testHousehold.id,
      userId: testUser.id,
      role: "admin",
    });

    // Seed a login history row so the export is non-empty (PII to protect).
    await db.insert(userLoginHistory).values({
      id: randomUUID(),
      userId: testUser.id,
      deviceName: "P6a Test Device",
      ipAddress: "203.0.113.5",
      location: "Lusaka, Zambia",
      success: true,
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  });

  afterAll(async () => {
    try {
      await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
      await db
        .delete(userLoginHistory)
        .where(eq(userLoginHistory.userId, userId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("P6a login-history cleanup error", error);
    }
  });

  it("GET .../login-history/export (json) writes a PROCESS/data_export audit row", async () => {
    const res = await request(app)
      .get("/api/settings/security/sessions/login-history/export")
      .set("Cookie", authCookie)
      .expect(200);

    expect(res.body.totalRecords).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, userId),
          eq(auditLogs.entityType, "data_export"),
          eq(auditLogs.action, "PROCESS"),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[rows.length - 1];
    expect(row.householdId).toBeNull();
    const details = row.details as Record<string, unknown> | null;
    expect(details?.exportType).toBe("login_history");
    expect(details?.fileFormat).toBe("json");
  });

  it("GET .../login-history/export?format=csv also writes an audit row (format recorded)", async () => {
    await request(app)
      .get("/api/settings/security/sessions/login-history/export?format=csv")
      .set("Cookie", authCookie)
      .expect(200);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, userId),
          eq(auditLogs.entityType, "data_export"),
          eq(auditLogs.action, "PROCESS"),
        ),
      );

    const csvRow = rows.find(
      (r) => (r.details as Record<string, unknown> | null)?.fileFormat === "csv",
    );
    expect(csvRow).toBeDefined();
  });
});
