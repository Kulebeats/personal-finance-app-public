/**
 * Receipt upload stored-XSS regression tests.
 *
 * These use real HTTP, real Postgres, and the real uploads directory.
 *
 * @module modules/receipts/__tests__/receipts.upload.db.integration.test
 */

import * as fs from "fs/promises";
import * as path from "path";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import {
  householdMembers,
  households,
  pendingReceipts,
  users,
} from "@shared/schema";
import {
  createTestHousehold,
  createTestUser,
  getTestApp,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const PASSWORD = "TestPassword123!";

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
  "base64",
);

function servedUrlFor(storagePath: string): string {
  return `/${storagePath.replace(/\\/g, "/")}`;
}

describe("Receipt upload stored-XSS regression", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const user = createTestUser({
      email: `receipt-xss-${timestamp}@example.com`,
      username: `receipt-xss-${timestamp}`,
      mfaEnabled: false,
    });
    const household = createTestHousehold(user.id, {
      name: "Receipt XSS Test Household",
      currency: "ZMW",
    });

    user.passwordHash = await hashPassword(PASSWORD);
    householdId = household.id;
    userId = user.id;

    await db.insert(households).values({
      id: household.id,
      name: household.name,
      currency: household.currency,
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

    await db.insert(householdMembers).values({
      householdId: household.id,
      userId: user.id,
      role: "admin",
    });

    const loginRes = await request(app).post("/api/auth/login").send({
      email: user.email,
      password: PASSWORD,
    });
    expect(loginRes.status).toBe(200);
    authCookie = (loginRes.headers["set-cookie"] as unknown as string[]).join(
      "; ",
    );
  });

  afterAll(async () => {
    await fs.rm(path.join(UPLOADS_ROOT, "receipts", householdId), {
      recursive: true,
      force: true,
    });

    await db
      .delete(pendingReceipts)
      .where(eq(pendingReceipts.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("rejects an unauthenticated upload with 401", async () => {
    const res = await request(app)
      .post("/api/receipts/upload")
      .attach("file", PNG_BUFFER, {
        filename: "receipt.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(401);
  });

  it("rejects spoofed image mimetypes when the bytes are not a real image", async () => {
    const res = await request(app)
      .post("/api/receipts/upload")
      .set("Cookie", authCookie)
      .attach("file", Buffer.from("<html><script>alert(1)</script></html>"), {
        filename: "fake.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects a truncated PNG that passes the magic-byte check with 400, not 500", async () => {
    // Valid PNG signature + IHDR, but the pixel data is cut off, so sharp
    // cannot decode it.
    const truncated = PNG_BUFFER.subarray(0, 33);
    const warn = vi.spyOn(console, "warn");

    try {
      const res = await request(app)
        .post("/api/receipts/upload")
        .set("Cookie", authCookie)
        .attach("file", truncated, {
          filename: "truncated.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");

      // The decoder's own message must reach the log, or the failure is
      // undiagnosable once it has been turned into a generic 400.
      const decodeLog = warn.mock.calls
        .map(([line]) => String(line))
        .find((line) => line.includes("Receipt image could not be decoded"));
      expect(decodeLog).toBeDefined();
      const entry = JSON.parse(decodeLog ?? "{}");
      expect(entry.error?.message).toMatch(/corrupt header/i);
    } finally {
      warn.mockRestore();
    }
  });

  it("stores an image/png named .html with a .png extension", async () => {
    const res = await request(app)
      .post("/api/receipts/upload")
      .set("Cookie", authCookie)
      .attach("file", PNG_BUFFER, {
        filename: "evil.html",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isDuplicate).toBe(false);

    const receiptId: string = res.body.data.receiptId;
    const [row] = await db
      .select()
      .from(pendingReceipts)
      .where(eq(pendingReceipts.id, receiptId));

    expect(row).toBeDefined();
    expect(row.filename).toMatch(/\.png$/);
    expect(row.filename).not.toMatch(/\.html$/);
    expect(row.storagePath).toMatch(/\.png$/);
    expect(row.storagePath).not.toMatch(/\.html$/);
    expect(row.originalFilename).toBe("evil.html");

    const url = servedUrlFor(row.storagePath);
    expect(url).toMatch(
      new RegExp(`^/uploads/receipts/${householdId}/[0-9a-f-]+\\.png$`),
    );
    expect(url).not.toMatch(/\.html$/);

    const served = await request(app).get(url).set("Cookie", authCookie);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toMatch(/^image\//);
    expect(served.headers["content-type"]).not.toMatch(/text\/html/);
  });
});
