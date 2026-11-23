/**
 * Profile Picture Upload/Delete — Real-DB Integration Tests
 *
 * R17 (dead-control cleanup): the client (ProfilePictureUpload.tsx) has
 * always called POST/DELETE /api/settings/profile/picture, but the server
 * returned a 501 stub — the upload/remove UI was fully built but could never
 * work. These tests exercise the real route against real Postgres and the
 * real uploads directory, mirroring settings.banner.db.integration.test.ts:
 *  - upload persists users.profilePictureUrl, writes the file, and writes an
 *    audit row
 *  - the stored URL is servable through the authenticated /uploads handler
 *  - re-upload replaces the previous file on disk
 *  - delete clears users.profilePictureUrl, removes the file, and writes an
 *    audit row
 *  - unauthenticated and invalid-type requests are rejected
 *
 * RED→GREEN guard: against the unfixed (501-stub) code both routes return
 * 501, so the happy-path cases fail (expected 200, got 501) and pass only
 * with the fix.
 *
 * @module modules/settings/__tests__/settings.picture.db.integration.test
 */

import * as fs from "fs/promises";
import * as path from "path";
import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../../../db";
import { users, households, householdMembers, auditLogs } from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { isStored, removeStoredUnder, storedNamesUnder } from "../../../__tests__/stored-upload-fixture";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const PASSWORD = "TestPassword123!";

// 1x1 transparent PNG
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("Profile Picture — Real DB Integration", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  const timestamp = Date.now();

  async function fetchUser() {
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    return row;
  }

  async function fetchPictureAuditRows() {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, userId),
          eq(auditLogs.entityType, "user"),
          eq(auditLogs.action, "UPDATE"),
        ),
      );
    return rows.filter((row) => {
      const details = row.details as Record<string, unknown> | null;
      return (
        details?.action === "profile_picture_upload" ||
        details?.action === "profile_picture_delete"
      );
    });
  }

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `picture-${timestamp}@example.com`,
      username: `picture-${timestamp}`,
      mfaEnabled: false,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Picture Test Household",
    });

    testUser.passwordHash = await hashPassword(PASSWORD);
    householdId = testHousehold.id;
    userId = testUser.id;

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

    const loginRes = await request(app).post("/api/auth/login").send({
      email: testUser.email,
      password: PASSWORD,
    });
    expect(loginRes.status).toBe(200);
    authCookie = loginRes.headers["set-cookie"][0];
  });

  afterAll(async () => {
    await removeStoredUnder(`profile-pictures/${householdId}/`);
    // Files/dirs created by uploads
    await fs.rm(path.join(UPLOADS_ROOT, "profile-pictures", householdId), {
      recursive: true,
      force: true,
    });

    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db
      .delete(householdMembers)
      .where(eq(householdMembers.householdId, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(households).where(eq(households.id, householdId));
  });

  it("rejects unauthenticated upload with 401", async () => {
    const res = await request(app)
      .post("/api/settings/profile/picture")
      .attach("picture", PNG_BUFFER, {
        filename: "avatar.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated delete with 401", async () => {
    const res = await request(app).delete("/api/settings/profile/picture");

    expect(res.status).toBe(401);
  });

  it("rejects an upload with no file (400)", async () => {
    const res = await request(app)
      .post("/api/settings/profile/picture")
      .set("Cookie", authCookie);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects a non-image upload (400) and does not touch users.profilePictureUrl", async () => {
    const res = await request(app)
      .post("/api/settings/profile/picture")
      .set("Cookie", authCookie)
      .attach("picture", Buffer.from("not an image"), {
        filename: "malicious.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    const user = await fetchUser();
    expect(user.profilePictureUrl).toBeNull();
  });

  it("rejects a spoofed image mimetype when the bytes are not a real image", async () => {
    const res = await request(app)
      .post("/api/settings/profile/picture")
      .set("Cookie", authCookie)
      .attach("picture", Buffer.from("<html><script>alert(1)</script></html>"), {
        filename: "fake.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    const user = await fetchUser();
    expect(user.profilePictureUrl).toBeNull();
  });

  it("ignores a spoofed extension: a mimetype-image with an .html filename is stored as an image", async () => {
    // SEC (stored-XSS): a crafted upload declaring image/png but named
    // "evil.html" must NOT be stored/served as .html — the extension comes
    // from the validated mimetype, not originalname.
    const res = await request(app)
      .post("/api/settings/profile/picture")
      .set("Cookie", authCookie)
      .attach("picture", PNG_BUFFER, {
        filename: "evil.html",
        contentType: "image/png",
      });

    expect(res.status).toBe(200);
    const pictureUrl: string = res.body.data.pictureUrl;
    expect(pictureUrl).toMatch(/\.png$/);
    expect(pictureUrl).not.toMatch(/\.html$/);

    // Clean up so this doesn't interfere with the ordered upload test below.
    await request(app)
      .delete("/api/settings/profile/picture")
      .set("Cookie", authCookie);
    const user = await fetchUser();
    expect(user.profilePictureUrl).toBeNull();
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
  });

  it("uploads a picture: persists users.profilePictureUrl, writes the file, an audit row, and returns the profile", async () => {
    const res = await request(app)
      .post("/api/settings/profile/picture")
      .set("Cookie", authCookie)
      .attach("picture", PNG_BUFFER, {
        filename: "avatar.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const pictureUrl: string = res.body.data.pictureUrl;
    expect(pictureUrl).toMatch(
      new RegExp(`^/uploads/profile-pictures/${householdId}/[0-9a-f-]+\\.png$`),
    );
    expect(res.body.data.profile.profilePictureUrl).toBe(pictureUrl);
    expect(res.body.data.profile.passwordHash).toBeUndefined();

    // Persisted on the user row
    const user = await fetchUser();
    expect(user.profilePictureUrl).toBe(pictureUrl);

    // File really on disk
    expect(await isStored(pictureUrl)).toBe(true);

    // DPA audit row (Rule 9)
    const auditRows = await fetchPictureAuditRows();
    expect(auditRows.length).toBe(1);
    const details = auditRows[0].details as Record<string, unknown>;
    expect(details.action).toBe("profile_picture_upload");
    expect(
      (details.newValue as Record<string, unknown>).profilePictureUrl,
    ).toBe(pictureUrl);
    expect(auditRows[0].householdId).toBe(householdId);
  });

  it("serves the uploaded picture through the authenticated /uploads handler", async () => {
    const user = await fetchUser();
    expect(user.profilePictureUrl).toBeTruthy();

    const authed = await request(app)
      .get(user.profilePictureUrl!)
      .set("Cookie", authCookie);
    expect(authed.status).toBe(200);
    expect(authed.body.length).toBeGreaterThan(0);

    const anonymous = await request(app).get(user.profilePictureUrl!);
    expect(anonymous.status).toBe(401);
  });

  it("replacing the picture removes the previous file from disk", async () => {
    const before = await fetchUser();
    const oldUrl = before.profilePictureUrl!;

    const res = await request(app)
      .post("/api/settings/profile/picture")
      .set("Cookie", authCookie)
      .attach("picture", PNG_BUFFER, {
        filename: "avatar2.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(200);
    const newUrl: string = res.body.data.pictureUrl;
    expect(newUrl).not.toBe(oldUrl);

    expect(await isStored(newUrl)).toBe(true);
    expect(await isStored(oldUrl)).toBe(false);
  });

  it("deletes the picture: clears users.profilePictureUrl, removes the file, writes an audit row", async () => {
    const before = await fetchUser();
    const pictureUrl = before.profilePictureUrl!;
    expect(pictureUrl).toBeTruthy();

    const res = await request(app)
      .delete("/api/settings/profile/picture")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.profile.profilePictureUrl).toBeNull();

    const user = await fetchUser();
    expect(user.profilePictureUrl).toBeNull();

    expect(await isStored(pictureUrl)).toBe(false);

    const deleteRows = (await fetchPictureAuditRows()).filter((row) => {
      const details = row.details as Record<string, unknown>;
      return details.action === "profile_picture_delete";
    });
    expect(deleteRows.length).toBe(1);
    const details = deleteRows[0].details as Record<string, unknown>;
    expect(
      (details.oldValue as Record<string, unknown>).profilePictureUrl,
    ).toBe(pictureUrl);
  });

  it("delete is idempotent when no picture is set (200, no extra audit row)", async () => {
    const auditCountBefore = (await fetchPictureAuditRows()).length;

    const res = await request(app)
      .delete("/api/settings/profile/picture")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.profile.profilePictureUrl).toBeNull();

    const auditCountAfter = (await fetchPictureAuditRows()).length;
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it("concurrent uploads leave exactly one file on disk (no orphan) matching users.profilePictureUrl", async () => {
    // Rule 10: two uploads racing on the same user must serialize on the
    // FOR UPDATE lock. Without it, both read the same oldPictureUrl and the
    // loser's file is orphaned. Both requests write a file up front, so
    // after both commit exactly ONE file must remain — the one
    // users.profilePictureUrl points at — and the other must have been
    // cleaned up.
    const [res1, res2] = await Promise.all([
      request(app)
        .post("/api/settings/profile/picture")
        .set("Cookie", authCookie)
        .attach("picture", PNG_BUFFER, {
          filename: "race1.png",
          contentType: "image/png",
        }),
      request(app)
        .post("/api/settings/profile/picture")
        .set("Cookie", authCookie)
        .attach("picture", PNG_BUFFER, {
          filename: "race2.png",
          contentType: "image/png",
        }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const user = await fetchUser();
    expect(user.profilePictureUrl).toBeTruthy();

    // OPS-001: files are stored objects; the manifest lists what is stored.
    const filesOnDisk = (await storedNamesUnder(`profile-pictures/${householdId}/`)).map((name) => path.basename(name));
    expect(filesOnDisk.length).toBe(1);
    expect(path.basename(user.profilePictureUrl!)).toBe(filesOnDisk[0]);
    expect(await isStored(user.profilePictureUrl!)).toBe(true);
  });
});
