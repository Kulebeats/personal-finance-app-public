/**
 * A-20: a signed-in, verified user with no household (newly registered, or a
 * member who left) can erase their account after step-up. Registration
 * creates no household, so this is a supported state, and R07.2 names the
 * household-free case. Real HTTP against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, securityAuditLogs, userPreferences, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

const password = "SyntheticHouseholdFreeErasure123!";
const userId = randomUUID();
const email = `household-free-erasure-${userId}@example.invalid`;
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;
let deleteStatus: number;

// A banner and picture left from a household the user has since left, stored
// before OPS-001 as legacy files with no manifest row (A-20 review, finding 5).
const formerHouseholdId = randomUUID();
const legacyBannerUrl = `/uploads/banners/${formerHouseholdId}/${randomUUID()}.png`;
const legacyPictureUrl = `/uploads/profile-pictures/${formerHouseholdId}/${randomUUID()}.png`;
const legacyFile = (url: string) => path.resolve(process.cwd(), ...url.replace(/^\//, "").split("/"));
const exists = (file: string) => fs.access(file).then(() => true, () => false);

describe("A-20 a household-free user can erase their account", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(users).values({
      id: userId, email, username: `household-free-erasure-${userId}`, passwordHash: await hashPassword(password), emailVerified: true,
      bannerUrl: legacyBannerUrl, profilePictureUrl: legacyPictureUrl,
    });
    for (const url of [legacyBannerUrl, legacyPictureUrl]) {
      await fs.mkdir(path.dirname(legacyFile(url)), { recursive: true });
      await fs.writeFile(legacyFile(url), "synthetic legacy upload");
    }
    await db.insert(userPreferences).values({ userId });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");

    await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
    const res = await request(app).post("/api/settings/account/delete").set("Cookie", cookie).send({ password });
    deleteStatus = res.status;
  }, 60000);

  afterAll(async () => {
    for (const url of [legacyBannerUrl, legacyPictureUrl]) await fs.rm(path.dirname(legacyFile(url)), { recursive: true, force: true });
    await pool.query("DELETE FROM storage_purge_items WHERE upload_name LIKE $1", [`%/${formerHouseholdId}/%`]);
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(securityAuditLogs).where(eq(securityAuditLogs.userId, userId));
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it("has no household before erasure (the precondition of the finding)", async () => {
    const memberships = await db.select().from(householdMembers).where(eq(householdMembers.userId, userId));
    expect(memberships).toEqual([]);
  });

  it("answers 200 instead of 404 Household not found", () => {
    expect(deleteStatus).toBe(200);
  });

  it("leaves a tombstone: identity scrubbed, credentials rotated, preferences gone", async () => {
    const [row] = await db.select({ erasedAt: users.erasedAt, email: users.email, passwordHash: users.passwordHash })
      .from(users).where(eq(users.id, userId));
    expect(row.erasedAt).not.toBeNull();
    expect(row.email).toMatch(/^deleted_.*@deleted\.invalid$/);
    expect(row.passwordHash).toMatch(/^!erased!/);
    expect(await db.select().from(userPreferences).where(eq(userPreferences.userId, userId))).toEqual([]);
  });

  it("writes the durable erasure audit row with no household", async () => {
    const rows = await db.select({ householdId: auditLogs.householdId, details: auditLogs.details }).from(auditLogs)
      .where(and(eq(auditLogs.userId, userId), eq(auditLogs.entityType, "user_account"), eq(auditLogs.action, "DELETE")));
    expect(rows).toHaveLength(1);
    expect(rows[0].householdId).toBeNull();
    expect(rows[0].details).toMatchObject({ reason: "right_to_erasure", erasedHouseholdId: null, householdDeleted: false });
  });

  it("deletes the legacy banner and picture the users row named, with no purge item left", async () => {
    expect(await exists(legacyFile(legacyBannerUrl))).toBe(false);
    expect(await exists(legacyFile(legacyPictureUrl))).toBe(false);
    const { rows } = await pool.query("SELECT id FROM storage_purge_items WHERE upload_name LIKE $1", [`%/${formerHouseholdId}/%`]);
    expect(rows).toEqual([]);
  });

  it("ends the session", async () => {
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
  });
});
