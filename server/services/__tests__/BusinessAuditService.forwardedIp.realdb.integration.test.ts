/**
 * BusinessAuditService.getIpAddress — forwarded proxy chain (REAL DB)
 *
 * Production defect found on the first hosted deployment (Render, 2026-11-15):
 * behind more than one proxy the `x-forwarded-for` header is a comma-separated
 * chain ("client, cdn, load-balancer"). getIpAddress returned that raw chain,
 * and `audit_logs.ip_address` is an `inet` column, so every in-transaction audit
 * write failed and rolled back its financial write (POST /api/transactions 500).
 * Audit writes outside a transaction failed silently, leaving no audit row.
 *
 * These tests send a real multi-hop header through a real Express app and write
 * the audit row to real Postgres. No local request carries a forwarded chain, so
 * nothing else in the suite exercises this path.
 *
 * @module services/__tests__/BusinessAuditService.forwardedIp.realdb.integration.test
 */

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { auditLogs } from "@shared/schema";
import { db } from "../../db";
import { withTransaction } from "../../utils/withTransaction";
import { businessAuditService } from "../BusinessAuditService";

const FORWARDED_CHAIN = "41.223.116.245, 104.22.160.46, 10.29.164.47";
const createdEntityIds: string[] = [];

function buildApp(trustProxy: number | false) {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.post("/audit", async (req, res) => {
    const entityId = randomUUID();
    createdEntityIds.push(entityId);
    const ipAddress = businessAuditService.getIpAddress(req);
    try {
      await withTransaction(async (tx) => {
        await businessAuditService.logCreate({
          tx,
          userId: null,
          householdId: null,
          entityType: "transaction",
          entityId,
          newValue: { source: "forwarded-ip-test" },
          ipAddress,
        });
      });
      res.json({ entityId, ipAddress: ipAddress ?? null });
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : "audit write failed" });
    }
  });
  return app;
}

async function readAuditIp(entityId: string): Promise<string | null | undefined> {
  const [row] = await db
    .select({ ipAddress: auditLogs.ipAddress })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, entityId));
  return row?.ipAddress;
}

afterAll(async () => {
  if (createdEntityIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, createdEntityIds));
  }
});

describe("BusinessAuditService.getIpAddress behind a proxy chain (real DB)", () => {
  it("writes the in-transaction audit row when x-forwarded-for carries three addresses", async () => {
    // Arrange
    const app = buildApp(1);

    // Act
    const response = await request(app).post("/audit").set("X-Forwarded-For", FORWARDED_CHAIN);

    // Assert
    expect(response.status).toBe(200);
    expect(isIP(response.body.ipAddress)).not.toBe(0);
    expect(await readAuditIp(response.body.entityId)).toBe(response.body.ipAddress);
  });

  it("records the address Express resolves for the configured number of trusted proxies", async () => {
    // Arrange: with three trusted hops the resolved client is the first address in the chain.
    const app = buildApp(3);

    // Act
    const response = await request(app).post("/audit").set("X-Forwarded-For", FORWARDED_CHAIN);

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.ipAddress).toBe("41.223.116.245");
    expect(await readAuditIp(response.body.entityId)).toBe("41.223.116.245");
  });

  it("ignores a forwarded header when no proxy is trusted", async () => {
    // Arrange: an untrusted client must not be able to choose the audited address.
    const app = buildApp(false);

    // Act
    const response = await request(app).post("/audit").set("X-Forwarded-For", "203.0.113.9");

    // Assert
    expect(response.status).toBe(200);
    expect(response.body.ipAddress).not.toBe("203.0.113.9");
    expect(isIP(response.body.ipAddress)).not.toBe(0);
  });
});
