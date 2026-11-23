/**
 * OPS-001 hardening (#249 review): the name authorized is the name read, a
 * case alias never reaches an unchecked legacy copy, last-member erasure
 * removes the erased user's stored images and every object the household's
 * manifest still names, erasure clean-up failures keep both the key and the
 * name, and the legacy move never audits a private attachment household-wide.
 * Real HTTP, real Postgres, local driver.
 */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import fsPromises from "fs/promises";
import * as path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import { auditLogs, householdMembers, storageObjects, transactionAttachments, transactions, users } from "@shared/schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../__tests__/signed-household-fixture";
import { resolveObjectStoreConfiguration } from "../storage/runtime";
import { putUploadObject, uploadNameOf } from "../storage/upload-objects";
import { moveLegacyUploads, rollbackLegacyMove } from "../storage/legacy-move";
import type { StorageKey } from "../storage";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import { recordErasedFileFailures } from "../../modules/settings/settings.account-deletion.files";
import { drainErasurePurgeItems, recordPurgeItems } from "../../modules/settings/settings.account-deletion.purge";
import { withTransaction } from "../../utils/withTransaction";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const PASSWORD = "SyntheticHardening123!";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const png = (seed: number) => sharp({ create: { width: 30 + seed, height: 20, channels: 3, background: { r: seed * 30, g: 60, b: 90 } } }).png().toBuffer();
const objectFile = (key: string) => {
  const configuration = resolveObjectStoreConfiguration(process.env);
  if (configuration.driver !== "local") throw new Error("this suite runs on the local-disk driver");
  return path.join(configuration.root, ...key.split("/"));
};
const exists = (file: string) => fs.access(file).then(() => true, () => false);
const manifest = async (stored: string) => (await db.select().from(storageObjects).where(eq(storageObjects.uploadName, uploadNameOf(stored)!)))[0];

let owner: SignedHousehold;
let member: { userId: string; headers: Record<string, string> };

async function addMember(household: SignedHousehold): Promise<{ userId: string; headers: Record<string, string> }> {
  const userId = randomUUID();
  const email = `ops001-member-${userId}@example.invalid`;
  await db.insert(users).values({ id: userId, email, username: `ops001-member-${userId}`, passwordHash: await hashPassword(PASSWORD), emailVerified: true });
  await db.insert(householdMembers).values({ householdId: household.householdId, userId, role: "member" });
  const login = await request(household.app).post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  return { userId, headers: { Cookie: cookie, "X-Capital-Subject": userId, "X-Capital-Household": household.householdId } };
}

beforeAll(async () => {
  owner = await createSignedHousehold("ops001-hardening");
  member = await addMember(owner);
}, 60_000);

afterAll(async () => {
  const rows = await db.select().from(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
  for (const row of rows) await fs.rm(objectFile(row.key), { force: true }).then(() => fs.rm(`${objectFile(row.key)}.json`, { force: true }));
  await fs.rm(path.join(UPLOADS_ROOT, "banners", owner.householdId), { recursive: true, force: true });
  await owner.cleanup(async () => {
    await db.delete(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
    await db.update(users).set({ bannerUrl: null }).where(eq(users.id, owner.userId));
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [member.userId]);
    await db.delete(auditLogs).where(eq(auditLogs.userId, member.userId));
    await db.delete(householdMembers).where(eq(householdMembers.userId, member.userId));
    await db.delete(users).where(eq(users.id, member.userId));
  });
}, 60_000);

describe("OPS-001 upload hardening (real Postgres)", () => {
  it("a backslash path never converts into another file: request names are authorized as read", async () => {
    // Before the fix a URL-form name with backslashes was converted and resolved elsewhere.
    expect(uploadNameOf(`/uploads/receipts/${owner.householdId}/..\\..\\transactions\\x\\y.pdf`)).toBeNull();

    const accountId = await insertAccount(owner);
    const transactionId = randomUUID();
    await db.insert(transactions).values({ id: transactionId, householdId: owner.householdId, accountId, ownerUserId: owner.userId,
      date: "2026-11-12", name: "Synthetic private purchase", amount: "12.00", type: "expense", isPrivate: true });
    const upload = await request(owner.app).post(`/api/transactions/${transactionId}/attachments`).set(owner.headers)
      .attach("file", await png(1), { filename: "slip.png", contentType: "image/png" }).expect(201);
    const [attachment] = await db.select().from(transactionAttachments).where(eq(transactionAttachments.id, upload.body.data.id));

    // The other member cannot reach the private transaction's attachment by either route.
    const escaped = `/uploads/receipts/${owner.householdId}/..%5C..%5Ctransactions%5C${transactionId}%5C${attachment.filename}`;
    await request(owner.app).get(escaped).set(member.headers).expect(403);
    await request(owner.app).get(`/uploads/receipts/${owner.householdId}/a%00b.png`).set(member.headers).expect(403);
    await request(owner.app).get(`/api/transactions/${transactionId}/attachments/${attachment.id}/download`).set(member.headers).expect(404);
    await request(owner.app).delete(`/api/transactions/${transactionId}/attachments/${attachment.id}`).set(owner.headers).expect(200);
  });

  it("a temp file that cannot be removed fails the upload before storing, and the controller cleanup removes it", async () => {
    const accountId = await insertAccount(owner);
    const transactionId = randomUUID();
    await db.insert(transactions).values({ id: transactionId, householdId: owner.householdId, accountId, ownerUserId: owner.userId,
      date: "2026-11-12", name: "Synthetic temp purchase", amount: "3.00", type: "expense", isPrivate: true });
    let tempPath = "";
    const realRm = fsPromises.rm.bind(fsPromises);
    const rm = vi.spyOn(fsPromises, "rm").mockImplementation(async (target, options) => {
      if (!tempPath) {
        tempPath = String(target);
        throw Object.assign(new Error("Synthetic EPERM"), { code: "EPERM" });
      }
      return realRm(target, options);
    });
    try {
      await request(owner.app).post(`/api/transactions/${transactionId}/attachments`).set(owner.headers)
        .attach("file", await png(7), { filename: "slip.png", contentType: "image/png" }).expect(500);
    } finally {
      rm.mockRestore();
    }

    expect(tempPath).not.toBe("");
    expect(await exists(tempPath)).toBe(false);
    expect(await db.select().from(transactionAttachments).where(eq(transactionAttachments.transactionId, transactionId))).toEqual([]);
    expect(await db.select().from(storageObjects).where(like(storageObjects.uploadName, `transactions/${transactionId}/%`))).toEqual([]);
  });

  it("a case alias of a stored file never falls back to its legacy copy", async () => {
    const bytes = await png(2);
    const upload = await request(owner.app).post("/api/settings/profile/banner").set(owner.headers)
      .attach("banner", bytes, { filename: "banner.png", contentType: "image/png" }).expect(200);
    const bannerUrl: string = upload.body.data.bannerUrl;
    // A stale legacy copy of the same file, as a legacy move leaves behind.
    const legacy = path.join(UPLOADS_ROOT, ...uploadNameOf(bannerUrl)!.split("/"));
    await fs.mkdir(path.dirname(legacy), { recursive: true });
    await fs.writeFile(legacy, Buffer.from("stale legacy bytes"));
    const served = await request(owner.app).get(bannerUrl).set(owner.headers).buffer(true).expect(200);
    expect(sha(served.body as Buffer)).toBe(sha(bytes));
    const alias = bannerUrl.replace(/[^/]+$/, (file) => file.toUpperCase());
    await request(owner.app).get(alias).set(owner.headers).expect(404);
  });

  it("last-member erasure removes the erased user's stored banner and profile picture", async () => {
    const solo = await createSignedHousehold("ops001-erase");
    const banner = await request(solo.app).post("/api/settings/profile/banner").set(solo.headers)
      .attach("banner", await png(3), { filename: "b.png", contentType: "image/png" }).expect(200);
    const picture = await request(solo.app).post("/api/settings/profile/picture").set(solo.headers)
      .attach("picture", await png(4), { filename: "p.png", contentType: "image/png" }).expect(200);
    const rows = [await manifest(banner.body.data.bannerUrl), await manifest(picture.body.data.pictureUrl)];
    expect(rows.every(Boolean)).toBe(true);
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, solo.userId));

    expect(await eraseAccount({ userId: solo.userId, householdId: solo.householdId, userEmail: user.email })).toEqual({ householdDeleted: true });

    expect(await db.select().from(storageObjects).where(inArray(storageObjects.key, rows.map((row) => row.key)))).toEqual([]);
    for (const row of rows) expect(await exists(objectFile(row.key)), row.key).toBe(false);
    await db.delete(auditLogs).where(eq(auditLogs.userId, solo.userId));
    await db.delete(users).where(eq(users.id, solo.userId));
  }, 60_000);

  it("an erasure file that cannot be deleted is logged, returned and audited, not swallowed, and the drain goes on", async () => {
    const target = { name: `banners/${owner.householdId}/${randomUUID()}.png`, key: "v1/banner/not-a-valid-key" as StorageKey, keepLegacy: false };
    const good = await putUploadObject({ stored: `/uploads/banners/${owner.householdId}/${randomUUID()}.png`, householdId: owner.householdId,
      purpose: "banner", bytes: await png(6), mediaType: "image/png", userId: owner.userId });
    const ids = await withTransaction((tx) => recordPurgeItems(tx, [target, good]));
    try {
      const failed = await drainErasurePurgeItems(ids);
      expect(failed).toEqual([target]);
      // The bad key counted one attempt; the good item was still removed.
      expect(await exists(objectFile(good.key!))).toBe(false);
      const { rows } = await pool.query<{ upload_name: string; attempts: number; last_error_code: string | null }>(
        "SELECT upload_name, attempts, last_error_code FROM storage_purge_items WHERE id = ANY($1::uuid[])", [ids]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ upload_name: target.name, attempts: 1 });
      expect(rows[0].last_error_code).toMatch(/^[A-Z_]+$/);
      await recordErasedFileFailures(owner.userId, failed);
    } finally {
      await pool.query("DELETE FROM storage_purge_items WHERE id = ANY($1::uuid[])", [ids]);
    }
    const [row] = await db.select().from(auditLogs).where(and(eq(auditLogs.userId, owner.userId), eq(auditLogs.entityType, "user_account")));
    // Both identifiers: after a partial delete the manifest is gone and only the name finds the legacy copy.
    expect(row.details).toMatchObject({ reason: "erasure_file_cleanup_failed", failed: 1,
      targets: [{ objectKey: "v1/banner/not-a-valid-key", uploadName: target.name }] });
  });

  it("a later collection fills in the key a pending purge item lacked", async () => {
    const name = `banners/${owner.householdId}/${randomUUID()}.png`;
    const key = "v1/banner/filled-in-later" as StorageKey;
    const [first] = await withTransaction((tx) => recordPurgeItems(tx, [{ name, key: null }]));
    try {
      const [second] = await withTransaction((tx) => recordPurgeItems(tx, [{ name, key }]));
      expect(second).toBe(first);
      const { rows } = await pool.query<{ object_key: string | null }>("SELECT object_key FROM storage_purge_items WHERE id = $1", [first]);
      expect(rows).toEqual([{ object_key: key }]);
    } finally {
      await pool.query("DELETE FROM storage_purge_items WHERE id = $1", [first]);
    }
  });

  it("last-member erasure removes an object only the manifest still names", async () => {
    const solo = await createSignedHousehold("ops001-orphan");
    // An attachment delete committed but its storage delete failed: no row references the object.
    const stored = `uploads/receipts/${solo.householdId}/${randomUUID()}.png`;
    const orphan = await putUploadObject({ stored, householdId: solo.householdId, purpose: "receipt", bytes: await png(5), mediaType: "image/png", userId: solo.userId });
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, solo.userId));

    expect(await eraseAccount({ userId: solo.userId, householdId: solo.householdId, userEmail: user.email })).toEqual({ householdDeleted: true });

    expect(await exists(objectFile(orphan.key!))).toBe(false);
    await db.delete(auditLogs).where(eq(auditLogs.userId, solo.userId));
    await db.delete(users).where(eq(users.id, solo.userId));
  }, 60_000);

  it("the legacy move and its rollback never audit a private transaction's attachment household-wide", async () => {
    const solo = await createSignedHousehold("ops001-private-move");
    const accountId = await insertAccount(solo);
    const transactionId = randomUUID();
    await db.insert(transactions).values({ id: transactionId, householdId: solo.householdId, accountId, ownerUserId: solo.userId,
      date: "2026-11-12", name: "Synthetic private legacy", amount: "9.00", type: "expense", isPrivate: true });
    const file = path.join(UPLOADS_ROOT, "transactions", transactionId, `${randomUUID()}.png`);
    const bytes = await png(6);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    await db.insert(transactionAttachments).values({ transactionId, filename: path.basename(file), originalFilename: "p.png",
      mimeType: "image/png", size: bytes.length, storagePath: file, uploadedBy: solo.userId });
    try {
      const report = await moveLegacyUploads({ apply: true, householdIds: [solo.householdId] });
      expect(report.moved).toHaveLength(1);
      const entityId = report.moved[0].key.slice(-36);
      expect((await rollbackLegacyMove([report.moved[0].key])).removed).toBe(1);

      const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "storage_object"), eq(auditLogs.entityId, entityId)));
      expect(audits.map((row) => row.action).sort()).toEqual(["CREATE", "DELETE"]);
      expect(audits.map((row) => row.householdId)).toEqual([null, null]);
      await db.delete(auditLogs).where(and(eq(auditLogs.entityType, "storage_object"), eq(auditLogs.entityId, entityId)));
    } finally {
      await fs.rm(path.dirname(file), { recursive: true, force: true });
      await solo.cleanup(async () => undefined);
    }
  }, 60_000);
});
