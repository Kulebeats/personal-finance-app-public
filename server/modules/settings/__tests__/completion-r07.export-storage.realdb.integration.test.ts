/**
 * R07.1 / AH-08 deploy gap: when the personal-export directory cannot be used,
 * POST /privacy/export answers 503 EXPORT_STORAGE_UNAVAILABLE (not a generic
 * 500) and writes nothing; a directory inside uploads/ is refused; the boot
 * check reports both. Real HTTP against real Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, dataExports, householdMembers, households, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { checkPersonalExportStorageAtBoot } from "../settings.privacy-export.storage";

const password = "SyntheticExportStorage123!";
const householdId = randomUUID();
const userId = randomUUID();
const originalDir = process.env.PERSONAL_EXPORT_DIR;
let app: Awaited<ReturnType<typeof getTestApp>>;
let cookie: string;
let scratch: string;
let unusableDir: string;

async function exportAttempt() {
  await request(app).post("/api/settings/security/step-up").set("Cookie", cookie).send({ password }).expect(200);
  return request(app).post("/api/settings/privacy/export").set("Cookie", cookie).send({});
}

async function exportTraces() {
  const rows = await db.select({ id: dataExports.id }).from(dataExports).where(eq(dataExports.userId, userId));
  const audits = await db.select({ id: auditLogs.id }).from(auditLogs)
    .where(and(eq(auditLogs.userId, userId), eq(auditLogs.entityType, "data_export")));
  return { rows: rows.length, audits: audits.length };
}

describe("R07.1 personal-export storage readiness", () => {
  beforeAll(async () => {
    app = await getTestApp();
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pfa-export-storage-"));
    // A directory below a regular file can never be created, whoever runs the suite.
    await fs.writeFile(path.join(scratch, "not-a-directory"), "synthetic");
    unusableDir = path.join(scratch, "not-a-directory", "exports");
    await db.insert(households).values({ id: householdId, name: "Synthetic export storage", currency: "ZMW" });
    const email = `export-storage-${userId}@example.invalid`;
    await db.insert(users).values({
      id: userId, email, username: `export-storage-${userId}`, passwordHash: await hashPassword(password), emailVerified: true,
    });
    await db.insert(householdMembers).values({ userId, householdId, role: "owner" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }, 60000);

  afterAll(async () => {
    if (originalDir === undefined) delete process.env.PERSONAL_EXPORT_DIR;
    else process.env.PERSONAL_EXPORT_DIR = originalDir;
    await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, userId));
    await db.delete(dataExports).where(eq(dataExports.userId, userId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(users).where(eq(users.id, userId));
    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("answers 503 EXPORT_STORAGE_UNAVAILABLE and writes no row or audit when the directory cannot be created", async () => {
    process.env.PERSONAL_EXPORT_DIR = unusableDir;
    const response = await exportAttempt();
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: "EXPORT_STORAGE_UNAVAILABLE", message: "Data exports are temporarily unavailable. Please try again later." },
    });
    expect(JSON.stringify(response.body)).not.toContain(scratch);
    expect(await exportTraces()).toEqual({ rows: 0, audits: 0 });
  });

  it("refuses a directory inside uploads/, which /uploads/* serves, and creates nothing there", async () => {
    const insideUploads = path.join(process.cwd(), "uploads", `personal-exports-${randomUUID()}`);
    process.env.PERSONAL_EXPORT_DIR = insideUploads;
    const response = await exportAttempt();
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("EXPORT_STORAGE_UNAVAILABLE");
    await expect(fs.stat(insideUploads)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await exportTraces()).toEqual({ rows: 0, audits: 0 });
  });

  it("the boot check fails for an unusable directory and passes, creating it, for a usable one", async () => {
    process.env.PERSONAL_EXPORT_DIR = unusableDir;
    expect(await checkPersonalExportStorageAtBoot()).toBe(false);
    const usable = path.join(scratch, "exports");
    process.env.PERSONAL_EXPORT_DIR = usable;
    expect(await checkPersonalExportStorageAtBoot()).toBe(true);
    expect((await fs.stat(usable)).isDirectory()).toBe(true);
  });
});
