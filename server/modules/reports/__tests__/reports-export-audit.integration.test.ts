/**
 * Reports CSV Export DPA Audit - Integration Test (SCP-336)
 *
 * Proves the financial+PII CSV export download records a data_export egress
 * audit row. Real HTTP + real Postgres.
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq, and } from "drizzle-orm";
import {
  dataExports,
  accounts,
  auditLogs,
  users,
  households,
  householdMembers,
  fxRates,
} from "@shared/schema";
import {
  createTestUser,
  createTestHousehold,
  getTestApp,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import {
  createFXRateRepository,
  createFXRateService,
  setGlobalFXService,
} from "../../../core/calculations";
import { randomUUID } from "crypto";

describe("Reports CSV Export DPA Audit (SCP-336)", () => {
  let app: Express;
  let authCookie: string;
  let csrfToken: string;
  let householdId: string;
  let userId: string;

  const authRequest = (req: request.Test) =>
    req.set("Cookie", authCookie).set("X-CSRF-Token", csrfToken);

  beforeAll(async () => {
    app = await getTestApp();

    // Report generation converts currencies; the global FX service is normally
    // wired in startup (not in the test harness), so initialize it here.
    const fxRepo = createFXRateRepository(db, fxRates);
    setGlobalFXService(
      createFXRateService(fxRepo, {
        cacheTtlSeconds: 300,
        baseCurrency: "USD",
        fallbackDays: 30,
      }),
    );

    const timestamp = Date.now();

    const testUser = createTestUser({
      email: `export-audit-${timestamp}@example.com`,
      username: `export-audit-user-${timestamp}`,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Export Audit Household",
      currency: "ZMW",
    });
    householdId = testHousehold.id;
    userId = testUser.id;
    testUser.passwordHash = await hashPassword("TestPassword123");

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

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: "TestPassword123" })
      .expect(200);
    authCookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    const csrfRes = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", authCookie)
      .expect(200);
    csrfToken = csrfRes.body.csrfToken;
    if (csrfRes.headers["set-cookie"]) {
      authCookie = [authCookie, ...csrfRes.headers["set-cookie"]].join("; ");
    }
  });

  afterAll(async () => {
    try {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db.delete(dataExports).where(eq(dataExports.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Export audit test cleanup error", error);
    }
  });

  it("writes a data_export PROCESS audit row on CSV download", async () => {
    // Create the export record
    const createRes = await authRequest(
      request(app).post("/api/reports/exports"),
    )
      .send({
        reportType: "networth",
        format: "csv",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      })
      .expect(200);

    const exportId = createRes.body.data?.id ?? createRes.body.id;
    expect(exportId).toBeTruthy();

    // Download it (this is the egress that must be audited)
    await authRequest(
      request(app).get(`/api/reports/exports/${exportId}?download=true`),
    ).expect(200);

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "data_export"),
          eq(auditLogs.entityId, exportId),
          eq(auditLogs.action, "PROCESS"),
        ),
      );
    expect(row).toBeDefined();
    expect(row.userId).toBe(userId);
    expect(row.householdId).toBe(householdId);
  });

  it("writes a data_export CREATE audit row when an export is created", async () => {
    // Creating an export reads financial+PII data and produces a stored export
    // artifact. That production must be traceable independently of any later
    // download (the gap named in the 2026-06-04 audit for createExport).
    const createRes = await authRequest(
      request(app).post("/api/reports/exports"),
    )
      .send({
        reportType: "transactions",
        format: "csv",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      })
      .expect(200);

    const exportId = createRes.body.data?.id ?? createRes.body.id;
    expect(exportId).toBeTruthy();

    // No download performed — the CREATE row must exist purely from creation.
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "data_export"),
          eq(auditLogs.entityId, exportId),
          eq(auditLogs.action, "CREATE"),
        ),
      );
    expect(row).toBeDefined();
    expect(row.userId).toBe(userId);
    expect(row.householdId).toBe(householdId);

    const details = row.details as Record<string, unknown>;
    expect(details.reportType).toBe("transactions");
    expect(details.fileFormat).toBe("csv");
    expect(details.dateRangeStart).toBe("2026-01-01");
    expect(details.dateRangeEnd).toBe("2026-12-31");
    expect(typeof details.recordCount).toBe("number");
    // Metadata only — the audit row must never carry the exported rows.
    expect(JSON.stringify(details)).not.toContain("notes");
  });
});
