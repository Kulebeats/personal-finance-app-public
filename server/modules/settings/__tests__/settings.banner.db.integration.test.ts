/**
 * Profile Banner Upload/Delete — Real-DB Integration Tests
 *
 * The client (BannerUpload.tsx) calls POST/DELETE /api/settings/profile/banner,
 * but the server had NO such route — the banner UI 404'd. These tests exercise
 * the real route against real Postgres and the real uploads directory:
 *  - upload persists users.bannerUrl, writes the file, and writes an audit row
 *  - the stored URL is servable through the authenticated /uploads handler
 *  - re-upload replaces the previous file on disk
 *  - delete clears users.bannerUrl, removes the file, and writes an audit row
 *  - unauthenticated and invalid-type requests are rejected
 *
 * RED→GREEN guard: against the unfixed code both banner routes are 404, so the
 * happy-path cases fail (expected 200, got 404) and pass only with the fix.
 *
 * @module modules/settings/__tests__/settings.banner.db.integration.test
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

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const PASSWORD = "TestPassword123!";

// 1x1 transparent PNG
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Resolve a stored bannerUrl ("/uploads/banners/{hh}/{file}") to its disk path. */
function diskPathFor(bannerUrl: string): string {
  return path.join(UPLOADS_ROOT, bannerUrl.replace(/^\/uploads\//, ""));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("Profile Banner — Real DB Integration", () => {
  let app: Express;
  let authCookie: string;
  let householdId: string;
  let userId: string;

  const timestamp = Date.now();

  async function fetchUser() {
    const [row] = await db.select().from(users).where(eq(users.id, userId));
    return row;
  }

  async function fetchBannerAuditRows() {
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
        details?.action === "banner_upload" ||
        details?.action === "banner_delete"
      );
    });
  }

  beforeAll(async () => {
    app = await getTestApp();

    const testUser = createTestUser({
      email: `banner-${timestamp}@example.com`,
      username: `banner-${timestamp}`,
      mfaEnabled: false,
    });
    const testHousehold = createTestHousehold(testUser.id, {
      name: "Banner Test Household",
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
    // Files/dirs created by uploads
    await fs.rm(path.join(UPLOADS_ROOT, "banners", householdId), {
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
      .post("/api/settings/profile/banner")
      .attach("banner", PNG_BUFFER, {
        filename: "cover.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated delete with 401", async () => {
    const res = await request(app).delete("/api/settings/profile/banner");

    expect(res.status).toBe(401);
  });

  it("rejects an upload with no file (400)", async () => {
    const res = await request(app)
      .post("/api/settings/profile/banner")
      .set("Cookie", authCookie);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects a non-image upload (400) and does not touch users.bannerUrl", async () => {
    const res = await request(app)
      .post("/api/settings/profile/banner")
      .set("Cookie", authCookie)
      .attach("banner", Buffer.from("not an image"), {
        filename: "malicious.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    const user = await fetchUser();
    expect(user.bannerUrl).toBeNull();
  });

  it("rejects a spoofed image mimetype when the bytes are not a real image", async () => {
    const res = await request(app)
      .post("/api/settings/profile/banner")
      .set("Cookie", authCookie)
      .attach("banner", Buffer.from("<html><script>alert(1)</script></html>"), {
        filename: "fake.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);

    const user = await fetchUser();
    expect(user.bannerUrl).toBeNull();
  });

  it("ignores a spoofed extension: a mimetype-image with an .html filename is stored as an image", async () => {
    // SEC (stored-XSS): a crafted upload declaring image/png but named
    // "evil.html" must NOT be stored/served as .html — the extension comes
    // from the validated mimetype, not originalname.
    const res = await request(app)
      .post("/api/settings/profile/banner")
      .set("Cookie", authCookie)
      .attach("banner", PNG_BUFFER, {
        filename: "evil.html",
        contentType: "image/png",
      });

    expect(res.status).toBe(200);
    const bannerUrl: string = res.body.data.bannerUrl;
    expect(bannerUrl).toMatch(/\.png$/);
    expect(bannerUrl).not.toMatch(/\.html$/);

    // Clean up so this doesn't interfere with the ordered upload test below.
    await request(app)
      .delete("/api/settings/profile/banner")
      .set("Cookie", authCookie);
    const user = await fetchUser();
    expect(user.bannerUrl).toBeNull();
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
  });

  it("uploads a banner: persists users.bannerUrl, writes the file and an audit row", async () => {
    const res = await request(app)
      .post("/api/settings/profile/banner")
      .set("Cookie", authCookie)
      .attach("banner", PNG_BUFFER, {
        filename: "cover.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const bannerUrl: string = res.body.data.bannerUrl;
    expect(bannerUrl).toMatch(
      new RegExp(`^/uploads/banners/${householdId}/[0-9a-f-]+\\.png$`),
    );

    // Persisted on the user row
    const user = await fetchUser();
    expect(user.bannerUrl).toBe(bannerUrl);

    // File really on disk
    expect(await fileExists(diskPathFor(bannerUrl))).toBe(true);

    // DPA audit row (Rule 9)
    const auditRows = await fetchBannerAuditRows();
    expect(auditRows.length).toBe(1);
    const details = auditRows[0].details as Record<string, unknown>;
    expect(details.action).toBe("banner_upload");
    expect((details.newValue as Record<string, unknown>).bannerUrl).toBe(
      bannerUrl,
    );
    expect(auditRows[0].householdId).toBe(householdId);
  });

  it("serves the uploaded banner through the authenticated /uploads handler", async () => {
    const user = await fetchUser();
    expect(user.bannerUrl).toBeTruthy();

    const authed = await request(app)
      .get(user.bannerUrl!)
      .set("Cookie", authCookie);
    expect(authed.status).toBe(200);
    expect(authed.body.length).toBeGreaterThan(0);

    const anonymous = await request(app).get(user.bannerUrl!);
    expect(anonymous.status).toBe(401);
  });

  it("replacing the banner removes the previous file from disk", async () => {
    const before = await fetchUser();
    const oldUrl = before.bannerUrl!;

    const res = await request(app)
      .post("/api/settings/profile/banner")
      .set("Cookie", authCookie)
      .attach("banner", PNG_BUFFER, {
        filename: "cover2.png",
        contentType: "image/png",
      });

    expect(res.status).toBe(200);
    const newUrl: string = res.body.data.bannerUrl;
    expect(newUrl).not.toBe(oldUrl);

    expect(await fileExists(diskPathFor(newUrl))).toBe(true);
    expect(await fileExists(diskPathFor(oldUrl))).toBe(false);
  });

  it("deletes the banner: clears users.bannerUrl, removes the file, writes an audit row", async () => {
    const before = await fetchUser();
    const bannerUrl = before.bannerUrl!;
    expect(bannerUrl).toBeTruthy();

    const res = await request(app)
      .delete("/api/settings/profile/banner")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bannerUrl).toBeNull();

    const user = await fetchUser();
    expect(user.bannerUrl).toBeNull();

    expect(await fileExists(diskPathFor(bannerUrl))).toBe(false);

    const deleteRows = (await fetchBannerAuditRows()).filter((row) => {
      const details = row.details as Record<string, unknown>;
      return details.action === "banner_delete";
    });
    expect(deleteRows.length).toBe(1);
    const details = deleteRows[0].details as Record<string, unknown>;
    expect((details.oldValue as Record<string, unknown>).bannerUrl).toBe(
      bannerUrl,
    );
  });

  it("delete is idempotent when no banner is set (200, no extra audit row)", async () => {
    const auditCountBefore = (await fetchBannerAuditRows()).length;

    const res = await request(app)
      .delete("/api/settings/profile/banner")
      .set("Cookie", authCookie);

    expect(res.status).toBe(200);
    expect(res.body.data.bannerUrl).toBeNull();

    const auditCountAfter = (await fetchBannerAuditRows()).length;
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it("concurrent uploads leave exactly one file on disk (no orphan) matching users.bannerUrl", async () => {
    // Rule 10: two uploads racing on the same user must serialize on the
    // FOR UPDATE lock. Without it, both read the same oldBannerUrl and the
    // loser's file is orphaned. Both requests write a file up front, so after
    // both commit exactly ONE file must remain — the one users.bannerUrl points
    // at — and the other must have been cleaned up.
    const [res1, res2] = await Promise.all([
      request(app)
        .post("/api/settings/profile/banner")
        .set("Cookie", authCookie)
        .attach("banner", PNG_BUFFER, {
          filename: "race1.png",
          contentType: "image/png",
        }),
      request(app)
        .post("/api/settings/profile/banner")
        .set("Cookie", authCookie)
        .attach("banner", PNG_BUFFER, {
          filename: "race2.png",
          contentType: "image/png",
        }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const user = await fetchUser();
    expect(user.bannerUrl).toBeTruthy();

    const dir = path.join(UPLOADS_ROOT, "banners", householdId);
    const filesOnDisk = await fs.readdir(dir);
    expect(filesOnDisk.length).toBe(1);
    expect(path.basename(user.bannerUrl!)).toBe(filesOnDisk[0]);
    expect(await fileExists(diskPathFor(user.bannerUrl!))).toBe(true);
  });
});
