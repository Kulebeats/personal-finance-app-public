/**
 * R07.1 / AH-08 (P1-4): personal-export files do not outlive their purpose.
 * The scheduled sweep expires ready exports past the retention window, deletes
 * their files and writes an audit row; it removes export files no ready row
 * owns (after a grace period, so an export being created is never touched);
 * and erasure leaves no export file behind, even when its post-commit removal
 * failed. Real HTTP and real Postgres.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "fs/promises";
import fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, dataExports, householdMembers, households, users } from "@shared/schema";
import { PERSONAL_EXPORT_TYPE } from "@shared/personal-data-export";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { SCHEDULED_JOBS } from "../../../core/scheduling/jobRegistry";
import { readPersonalExportFile, writePersonalExportFile, type PersonalExportFileFormat } from "../settings.privacy-export.files";
import { sweepPersonalExports } from "../settings.privacy-export.retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const password = "SyntheticExportRetention123!";
const originalDir = process.env.PERSONAL_EXPORT_DIR;
const userIds: string[] = [];
const householdIds: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
let exportDir: string;
type Actor = { id: string; cookie: string };
let keeper: Actor;
let leaver: Actor;

async function actor(label: string): Promise<Actor> {
  const id = randomUUID();
  const householdId = randomUUID();
  const email = `export-retention-${label}-${id}@example.invalid`;
  await db.insert(households).values({ id: householdId, name: `Synthetic retention ${label}`, currency: "ZMW" });
  await db.insert(users).values({
    id, email, username: `export-retention-${id}`, passwordHash: await hashPassword(password), emailVerified: true,
  });
  await db.insert(householdMembers).values({ userId: id, householdId, role: "owner" });
  userIds.push(id);
  householdIds.push(householdId);
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

/** A stored export: its row (created `ageDays` ago) and its file. */
async function storedExport(userId: string, ageDays: number, status = "ready"): Promise<string> {
  const id = randomUUID();
  const bytes = Buffer.from("{\"synthetic\":true}");
  const sections = { profile: 1, memberships: 0, preferences: 0, accounts: 0, transactions: 0, categories: 0, securityEvents: 0 };
  await db.insert(dataExports).values({
    id, userId, householdId: null, exportType: PERSONAL_EXPORT_TYPE, fileFormat: "json", status,
    fileUrl: `/api/settings/privacy/exports/${id}/download`, recordCount: 1,
    parameters: { kind: PERSONAL_EXPORT_TYPE, version: 1, householdId: null,
      sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, sections },
    createdAt: new Date(Date.now() - ageDays * DAY_MS),
  });
  await writePersonalExportFile(id, bytes);
  await ageFile(id, ageDays);
  return id;
}

async function ageFile(exportId: string, ageDays: number, format: PersonalExportFileFormat = "json"): Promise<void> {
  const when = new Date(Date.now() - ageDays * DAY_MS);
  await fs.utimes(path.join(exportDir, `${exportId}.${format}`), when, when);
}

const FORMATS: readonly PersonalExportFileFormat[] = ["json", "zip"];
const hasFile = (exportId: string, format: PersonalExportFileFormat) =>
  readPersonalExportFile(exportId, format).then(() => true, () => false);
/** A version 1 export is `<id>.json`, a version 2 export (A-27) is `<id>.zip`: either counts. */
const fileExists = async (exportId: string) => (await Promise.all(FORMATS.map(format => hasFile(exportId, format)))).some(Boolean);

async function retentionAudits(exportId: string) {
  return db.select().from(auditLogs).where(and(
    eq(auditLogs.entityType, "data_export"), eq(auditLogs.entityId, exportId), eq(auditLogs.action, "DELETE"),
  ));
}

describe("R07.1 personal-export retention and leftovers", () => {
  beforeAll(async () => {
    exportDir = await fs.mkdtemp(path.join(os.tmpdir(), "pfa-export-retention-"));
    process.env.PERSONAL_EXPORT_DIR = exportDir;
    app = await getTestApp();
    keeper = await actor("keeper");
    leaver = await actor("leaver");
  }, 60000);

  afterEach(() => { vi.restoreAllMocks(); });

  afterAll(async () => {
    if (originalDir === undefined) delete process.env.PERSONAL_EXPORT_DIR;
    else process.env.PERSONAL_EXPORT_DIR = originalDir;
    for (const id of userIds) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds));
    await db.delete(dataExports).where(inArray(dataExports.userId, userIds));
    await db.delete(householdMembers).where(inArray(householdMembers.userId, userIds));
    await db.delete(households).where(inArray(households.id, householdIds));
    await db.delete(users).where(inArray(users.id, userIds));
    await fs.rm(exportDir, { recursive: true, force: true });
  });

  it("runs as a scheduled cleanup job", () => {
    expect(SCHEDULED_JOBS.map((job) => job.name)).toContain("cleanup.personal-exports");
  });

  it("expires a ready export past the window, deletes its file and audits it once; a fresh one stays", async () => {
    const old = await storedExport(keeper.id, 8);
    const fresh = await storedExport(keeper.id, 1);

    const summary = await sweepPersonalExports();
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(summary.failed).toBe(0);

    const [oldRow] = await db.select().from(dataExports).where(eq(dataExports.id, old));
    expect(oldRow.status).toBe("expired");
    expect(await fileExists(old)).toBe(false);
    const audits = await retentionAudits(old);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: keeper.id, householdId: null });
    expect(audits[0].details).toMatchObject({ exportType: PERSONAL_EXPORT_TYPE, reason: "retention", retentionDays: 7 });

    const [freshRow] = await db.select().from(dataExports).where(eq(dataExports.id, fresh));
    expect(freshRow.status).toBe("ready");
    expect(await fileExists(fresh)).toBe(true);
    expect(await retentionAudits(fresh)).toHaveLength(0);

    // A second run neither re-expires nor re-audits.
    await sweepPersonalExports();
    expect(await retentionAudits(old)).toHaveLength(1);

    const listed = await request(app).get("/api/settings/privacy/exports").set("Cookie", keeper.cookie).expect(200);
    const statuses = Object.fromEntries((listed.body.data as { id: string; status: string }[]).map((item) => [item.id, item.status]));
    expect(statuses).toMatchObject({ [old]: "expired", [fresh]: "ready" });
    await request(app).get(`/api/settings/privacy/exports/${old}/download`).set("Cookie", keeper.cookie).expect(410);
  });

  it("a failed file removal rolls the expiry and its audit back; the next run retires it once", async () => {
    const stuck = await storedExport(keeper.id, 8);
    const realUnlink = fsPromises.unlink.bind(fsPromises);
    const busy = vi.spyOn(fsPromises, "unlink").mockImplementation(async (target) => {
      if (String(target).includes(stuck)) throw Object.assign(new Error("synthetic busy file"), { code: "EBUSY" });
      return realUnlink(target);
    });

    const failedRun = await sweepPersonalExports();
    expect(busy).toHaveBeenCalled();
    expect({ expired: failedRun.expired, failed: failedRun.failed }).toEqual({ expired: 0, failed: 1 });
    const [kept] = await db.select().from(dataExports).where(eq(dataExports.id, stuck));
    expect(kept.status).toBe("ready");
    expect(await fileExists(stuck)).toBe(true);
    expect(await retentionAudits(stuck)).toHaveLength(0);

    busy.mockRestore();
    const retry = await sweepPersonalExports();
    expect({ expired: retry.expired, failed: retry.failed }).toEqual({ expired: 1, failed: 0 });
    const [retired] = await db.select().from(dataExports).where(eq(dataExports.id, stuck));
    expect(retired.status).toBe("expired");
    expect(await fileExists(stuck)).toBe(false);
    expect(await retentionAudits(stuck)).toHaveLength(1);
  });

  it("removes old files no ready export owns and keeps a file still being created", async () => {
    const orphan = randomUUID();
    await writePersonalExportFile(orphan, Buffer.from("{}"));
    await ageFile(orphan, 2);
    const inFlight = randomUUID();
    await writePersonalExportFile(inFlight, Buffer.from("{}"));
    const failedRow = await storedExport(keeper.id, 2, "failed");
    await fs.writeFile(path.join(exportDir, "not-an-export.txt"), "synthetic");

    const summary = await sweepPersonalExports();
    expect(summary.orphansRemoved).toBeGreaterThanOrEqual(2);
    expect(await fileExists(orphan)).toBe(false);
    expect(await fileExists(failedRow)).toBe(false);
    expect(await fileExists(inFlight)).toBe(true);
    await expect(fs.stat(path.join(exportDir, "not-an-export.txt"))).resolves.toBeDefined();
  });

  it("a sole member's erasure removes their exports, and the sweep removes a file the erasure left behind", async () => {
    await request(app).post("/api/settings/security/step-up").set("Cookie", leaver.cookie).send({ password }).expect(200);
    const created = await request(app).post("/api/settings/privacy/export").set("Cookie", leaver.cookie).send({}).expect(201);
    const exportId: string = created.body.data.id;
    expect(await hasFile(exportId, "zip")).toBe(true);

    await request(app).post("/api/settings/account/delete").set("Cookie", leaver.cookie).send({ password }).expect(200);
    expect(await db.select().from(dataExports).where(eq(dataExports.id, exportId))).toHaveLength(0);
    expect(await fileExists(exportId)).toBe(false);

    // The post-commit removal is best effort: a file it failed to remove is an orphan, in either format.
    await writePersonalExportFile(exportId, Buffer.from("{\"leftover\":true}"));
    await ageFile(exportId, 2);
    await writePersonalExportFile(exportId, Buffer.from("PK-leftover"), "zip");
    await ageFile(exportId, 2, "zip");
    await sweepPersonalExports();
    expect(await fileExists(exportId)).toBe(false);
  });
});
