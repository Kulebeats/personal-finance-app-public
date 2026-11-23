/**
 * Goal image upload stored-XSS regression tests.
 *
 * These use real HTTP, real Postgres, and the real uploads directory.
 *
 * @module modules/goals/__tests__/goals.images.db.integration.test
 */

import * as fs from "fs/promises";
import * as path from "path";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import {
  goalImageUploads,
  householdMembers,
  households,
  users,
} from "@shared/schema";
import {
  createTestHousehold,
  createTestUser,
  getTestApp,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { isStored, removeStoredUnder } from "../../../__tests__/stored-upload-fixture";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const PASSWORD = "TestPassword123!";

const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);


describe("Goal images upload stored-XSS regression", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    const user = createTestUser({
      email: `goal-image-${timestamp}@example.com`,
      username: `goal-image-${timestamp}`,
      mfaEnabled: false,
    });
    const household = createTestHousehold(user.id, {
      name: "Goal Image Test Household",
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
    await removeStoredUnder(`goals/${householdId}/`);
    await fs.rm(path.join(UPLOADS_ROOT, "goals", householdId), {
      recursive: true,
      force: true,
    });

    await db
      .delete(goalImageUploads)
      .where(eq(goalImageUploads.householdId, householdId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("rejects an unauthenticated upload with 401", async () => {
    const res = await request(app)
      .post("/api/goals/images")
      .attach("file", PNG_BUFFER, {
        filename: "cover.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(401);
  });

  it("rejects non-image uploads", async () => {
    const res = await request(app)
      .post("/api/goals/images")
      .set("Cookie", authCookie)
      .attach("file", Buffer.from("not an image"), {
        filename: "malicious.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects spoofed image mimetypes when the bytes are not a real image", async () => {
    const res = await request(app)
      .post("/api/goals/images")
      .set("Cookie", authCookie)
      .attach("file", Buffer.from("<html><script>alert(1)</script></html>"), {
        filename: "fake.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("stores an image/png named .html with a .png extension", async () => {
    const res = await request(app)
      .post("/api/goals/images")
      .set("Cookie", authCookie)
      .attach("file", PNG_BUFFER, {
        filename: "evil.html",
        contentType: "image/png",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const url: string = res.body.data.image.url;
    expect(url).toMatch(
      new RegExp(`^/uploads/goals/${householdId}/[0-9a-f-]+\\.png$`),
    );
    expect(url).not.toMatch(/\.html$/);

    const [row] = await db
      .select()
      .from(goalImageUploads)
      .where(eq(goalImageUploads.householdId, householdId));
    expect(row.storedFilename).toMatch(/\.png$/);
    expect(row.storedFilename).not.toMatch(/\.html$/);
    expect(row.filePath).not.toMatch(/\.html$/);

    const served = await request(app).get(url).set("Cookie", authCookie);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toMatch(/^image\//);
    expect(served.headers["content-type"]).not.toMatch(/text\/html/);
  });

  it("uploads and lists a legitimate png", async () => {
    const upload = await request(app)
      .post("/api/goals/images")
      .set("Cookie", authCookie)
      .attach("file", PNG_BUFFER, {
        filename: "vacation.png",
        contentType: "image/png",
      });

    expect(upload.status).toBe(201);
    const url: string = upload.body.data.image.url;
    expect(url).toMatch(/\.png$/);
    expect(await isStored(url)).toBe(true);

    const list = await request(app)
      .get("/api/goals/images")
      .set("Cookie", authCookie);

    expect(list.status).toBe(200);
    expect(list.body.success).toBe(true);
    const urls = (list.body.data as Array<{ url: string }>).map(
      (image) => image.url,
    );
    expect(urls).toContain(url);
  });
});
