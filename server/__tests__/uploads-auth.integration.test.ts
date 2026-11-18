/**
 * Uploads Auth - Integration Tests (SEC-327, CWE-639)
 *
 * Verifies the /uploads/* route is authenticated and ownership-checked:
 *  - A user of household B cannot fetch a file under household A's path (403)
 *  - A user of household A can fetch their own file (200)
 *  - Path-traversal attempts are rejected (403/404)
 *  - Unauthenticated requests are rejected (401)
 *
 * Real-DB + real-HTTP test (per CLAUDE.md Rule 17): two households are seeded
 * in Postgres, files are written to the real uploads directory, and requests
 * go through the full Express stack.
 *
 * @module __tests__/uploads-auth.integration.test
 */

import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, households, householdMembers } from "@shared/schema";
import { createTestUser, createTestHousehold, getTestApp } from "./fixtures";
import { hashPassword } from "../auth";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");

interface SeededHousehold {
  householdId: string;
  userId: string;
  email: string;
  authCookie: string;
}

async function seedHouseholdWithUser(label: string): Promise<SeededHousehold> {
  const timestamp = Date.now();
  const testUser = createTestUser({
    email: `uploads-${label}-${timestamp}-${randomUUID().slice(0, 6)}@example.com`,
    username: `uploads-${label}-${timestamp}-${randomUUID().slice(0, 6)}`,
  });
  const testHousehold = createTestHousehold(testUser.id, {
    name: `Uploads ${label} Household`,
    currency: "ZMW",
  });

  testUser.passwordHash = await hashPassword("TestPassword123");
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

  return {
    householdId: testHousehold.id,
    userId: testUser.id,
    email: testUser.email,
    authCookie: "",
  };
}

describe("Uploads Auth Integration Tests (SEC-327)", () => {
  let app: Express;
  let householdA: SeededHousehold;
  let householdB: SeededHousehold;
  let filename: string;
  let createdFiles: string[] = [];

  async function login(email: string): Promise<string> {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "TestPassword123" })
      .expect(200);
    return loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  }

  beforeAll(async () => {
    app = await getTestApp();

    householdA = await seedHouseholdWithUser("a");
    householdB = await seedHouseholdWithUser("b");

    householdA.authCookie = await login(householdA.email);
    householdB.authCookie = await login(householdB.email);

    // Write a real file under household A's goal-images path:
    // uploads/goals/{householdAId}/{filename}
    filename = `${randomUUID()}.png`;
    const dir = path.join(UPLOADS_ROOT, "goals", householdA.householdId);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    // 1x1 transparent PNG
    const pngBuffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await fs.writeFile(filePath, pngBuffer);
    createdFiles.push(filePath);
  });

  afterAll(async () => {
    // Remove files we created
    for (const f of createdFiles) {
      try {
        await fs.unlink(f);
      } catch {
        /* ignore */
      }
    }
    try {
      await fs.rmdir(path.join(UPLOADS_ROOT, "goals", householdA.householdId));
    } catch {
      /* ignore - directory may not be empty or already gone */
    }

    // Remove seeded DB rows in dependency order (users keyed by id; the users
    // table has no household_id column).
    for (const h of [householdA, householdB]) {
      try {
        await db
          .delete(householdMembers)
          .where(eq(householdMembers.householdId, h.householdId));
        await db.delete(users).where(eq(users.id, h.userId));
        await db.delete(households).where(eq(households.id, h.householdId));
      } catch (error) {
        console.error("Cleanup error (may be expected):", error);
      }
    }
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get(
      `/uploads/goals/${householdA.householdId}/${filename}`,
    );
    expect(res.status).toBe(401);
  });

  it("allows household A's user to fetch their own file (200)", async () => {
    const res = await request(app)
      .get(`/uploads/goals/${householdA.householdId}/${filename}`)
      .set("Cookie", householdA.authCookie);

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("blocks household B from fetching household A's file (403/404)", async () => {
    const res = await request(app)
      .get(`/uploads/goals/${householdA.householdId}/${filename}`)
      .set("Cookie", householdB.authCookie);

    expect([403, 404]).toContain(res.status);
    // Specifically a cross-household access denial.
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("rejects path-traversal attempts (../) ", async () => {
    // Attempt to climb out of the household directory and the uploads root.
    const traversal = `/uploads/goals/${householdA.householdId}/..%2f..%2f..%2fpackage.json`;
    const res = await request(app)
      .get(traversal)
      .set("Cookie", householdA.authCookie);

    // Must NOT return 200 with file contents.
    expect(res.status).not.toBe(200);
    expect([403, 404]).toContain(res.status);
  });

  it("rejects a traversal that resolves to another household's directory", async () => {
    // Even if the leading segment is the caller's household, a traversal that
    // resolves into household A's directory from household B must be denied.
    const sneaky = `/uploads/goals/${householdB.householdId}/..%2f${householdA.householdId}%2f${filename}`;
    const res = await request(app)
      .get(sneaky)
      .set("Cookie", householdB.authCookie);

    expect(res.status).not.toBe(200);
    expect([403, 404]).toContain(res.status);
  });

  it("denies access to non-household-scoped upload prefixes", async () => {
    // transactions/* are served by a dedicated API route, not /uploads.
    for (const requestPath of [
      `/uploads/transactions/${randomUUID()}/${filename}`,
      `/uploads/temp/${filename}`,
    ]) {
      const res = await request(app)
        .get(requestPath)
        .set("Cookie", householdA.authCookie);

      expect(res.status).toBe(403);
    }
  });
});
