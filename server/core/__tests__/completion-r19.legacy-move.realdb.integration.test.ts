/**
 * OPS-001 legacy move with rollback, and erasure of moved files.
 *
 * Legacy files are written the way the pre-OPS-001 writers wrote them (plain
 * files under uploads/, referenced by real rows). The move copies each into the
 * ObjectStore with a manifest row and an audit row, leaves the legacy file in
 * place, and is idempotent; served bytes then come from the store. Rollback
 * removes exactly the moved objects and rows, and reads fall back to the
 * legacy file. Erasure after a move removes the object and the legacy copy.
 */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, goalImageUploads, storageObjects, transactionAttachments, transactions, users } from "@shared/schema";
import { db } from "../../db";
import { withTransaction } from "../../utils/withTransaction";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../__tests__/signed-household-fixture";
import { storedBytes } from "../../__tests__/stored-upload-fixture";
import { moveLegacyUploads, rollbackLegacyMove, type LegacyMoveReport } from "../storage/legacy-move";
import { resolveObjectStoreConfiguration } from "../storage/runtime";
import { collectHouseholdUploadPaths, collectUserUploadPaths } from "../../modules/settings/settings.account-deletion.files";
import { drainErasurePurgeItems, recordPurgeItems } from "../../modules/settings/settings.account-deletion.purge";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
function objectPath(key: string): string {
  const configuration = resolveObjectStoreConfiguration(process.env);
  if (configuration.driver !== "local") throw new Error("this suite runs on the local-disk driver");
  return path.join(configuration.root, ...key.split("/"));
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const onDisk = (relative: string) => fs.access(path.join(UPLOADS_ROOT, relative)).then(() => true, () => false);

let owner: SignedHousehold;
let bannerUrl: string;
let goalPath: string;
let attachmentPath: string;
let transactionId: string;
let attachmentId: string;
const bytes: Record<string, Buffer> = {};

async function writeLegacy(relative: string, content: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(path.join(UPLOADS_ROOT, relative)), { recursive: true });
  await fs.writeFile(path.join(UPLOADS_ROOT, relative), content);
}
async function png(seed: number): Promise<Buffer> {
  return sharp({ create: { width: 20 + seed, height: 20, channels: 3, background: { r: seed * 40, g: 10, b: 200 } } }).png().toBuffer();
}
async function moveAudits(action: "CREATE" | "DELETE") {
  return db.select().from(auditLogs).where(and(eq(auditLogs.householdId, owner.householdId), eq(auditLogs.entityType, "storage_object"), eq(auditLogs.action, action)));
}
const apply = () => moveLegacyUploads({ apply: true, householdIds: [owner.householdId] });

beforeAll(async () => {
  owner = await createSignedHousehold("ops001-legacy");
  const hh = owner.householdId;
  bannerUrl = `/uploads/banners/${hh}/${randomUUID()}.png`;
  bytes.banner = await png(1);
  await writeLegacy(bannerUrl.slice("/uploads/".length), bytes.banner);
  await db.update(users).set({ bannerUrl }).where(eq(users.id, owner.userId));

  goalPath = path.join("uploads", "goals", hh, `${randomUUID()}.png`);
  bytes.goal = await png(2);
  await writeLegacy(path.relative("uploads", goalPath), bytes.goal);
  await db.insert(goalImageUploads).values({ householdId: hh, originalFilename: "goal.png", storedFilename: path.basename(goalPath),
    filePath: goalPath, fileSize: bytes.goal.length, mimeType: "image/png", uploadedBy: owner.userId });

  // Attachments were stored as absolute paths by the legacy writer.
  const accountId = await insertAccount(owner);
  transactionId = randomUUID();
  await db.insert(transactions).values({ id: transactionId, householdId: hh, accountId, ownerUserId: owner.userId,
    date: "2026-11-10", name: "Synthetic legacy purchase", amount: "10.00", type: "expense", isPrivate: false });
  attachmentPath = path.join(UPLOADS_ROOT, "transactions", transactionId, `${randomUUID()}.png`);
  bytes.attachment = await png(3);
  await writeLegacy(path.relative(UPLOADS_ROOT, attachmentPath), bytes.attachment);
  const [attachment] = await db.insert(transactionAttachments).values({ transactionId, filename: path.basename(attachmentPath),
    originalFilename: "slip.png", mimeType: "image/png", size: bytes.attachment.length, storagePath: attachmentPath, uploadedBy: owner.userId }).returning();
  attachmentId = attachment.id;

  // A referenced file that is already gone is reported, never invented.
  await db.insert(goalImageUploads).values({ householdId: hh, originalFilename: "gone.png", storedFilename: "gone.png",
    filePath: path.join("uploads", "goals", hh, `${randomUUID()}.png`), fileSize: 1, mimeType: "image/png", uploadedBy: owner.userId });
}, 60_000);

afterAll(async () => {
  const rows = await db.select().from(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
  await rollbackLegacyMove(rows.map((row) => row.key));
  await fs.rm(path.join(UPLOADS_ROOT, "banners", owner.householdId), { recursive: true, force: true });
  await fs.rm(path.join(UPLOADS_ROOT, "goals", owner.householdId), { recursive: true, force: true });
  await fs.rm(path.join(UPLOADS_ROOT, "transactions", transactionId), { recursive: true, force: true });
  await owner.cleanup(async () => {
    await db.delete(goalImageUploads).where(eq(goalImageUploads.householdId, owner.householdId));
    await db.update(users).set({ bannerUrl: null }).where(eq(users.id, owner.userId));
  });
}, 60_000);

describe("OPS-001 legacy upload move", () => {
  let report: LegacyMoveReport;

  it("a dry run lists what would move and stores nothing", async () => {
    const dry = await moveLegacyUploads({ apply: false, householdIds: [owner.householdId] });
    expect(dry.applied).toBe(false);
    expect(dry.moved).toEqual([]);
    expect(dry.pending.map((entry) => entry.sha256).sort()).toEqual([sha(bytes.banner), sha(bytes.goal), sha(bytes.attachment)].sort());
    expect(dry.missing).toHaveLength(1);
    expect(await db.select().from(storageObjects).where(eq(storageObjects.householdId, owner.householdId))).toEqual([]);
  });

  it("apply copies each file with a checked manifest and an audit row, keeps the legacy file, and is idempotent", async () => {
    report = await apply();
    expect(report.moved).toHaveLength(3);
    expect(report.missing).toHaveLength(1);
    const rows = await db.select().from(storageObjects).where(eq(storageObjects.householdId, owner.householdId));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.movedFromLegacyAt).not.toBeNull();
      expect(sha((await storedBytes(`uploads/${row.uploadName}`))!)).toBe(row.sha256);
    }
    expect(rows.map((row) => row.purpose).sort()).toEqual(["attachment", "banner", "goal-image"]);
    expect(await moveAudits("CREATE")).toHaveLength(3);
    expect(await onDisk(bannerUrl.slice("/uploads/".length))).toBe(true);

    const again = await apply();
    expect(again.moved).toEqual([]);
    expect(again.alreadyStored).toBe(3);
  });

  it("after the move, reads come from the store", async () => {
    // Alter the legacy copy: the served bytes stay the moved, checksummed ones.
    await writeLegacy(bannerUrl.slice("/uploads/".length), Buffer.from("not the moved bytes"));
    const served = await request(owner.app).get(bannerUrl).set(owner.headers).buffer(true).expect(200);
    expect(sha(served.body as Buffer)).toBe(sha(bytes.banner));
    const download = await request(owner.app).get(`/api/transactions/${transactionId}/attachments/${attachmentId}/download`)
      .set(owner.headers).buffer(true).expect(200);
    expect(sha(download.body as Buffer)).toBe(sha(bytes.attachment));
  });

  it("rollback removes exactly the moved objects and rows; reads fall back to verified legacy files", async () => {
    const result = await rollbackLegacyMove(report.moved.map((entry) => entry.key));
    // The altered legacy banner is put back to the moved, checksummed bytes before its object goes.
    expect(result).toEqual({ removed: 3, restored: 1, refused: [], skipped: 0, retried: 0, pendingCleanup: [] });
    expect(await db.select().from(storageObjects).where(eq(storageObjects.householdId, owner.householdId))).toEqual([]);
    expect(await moveAudits("DELETE")).toHaveLength(3);
    const served = await request(owner.app).get(bannerUrl).set(owner.headers).buffer(true).expect(200);
    expect(sha(served.body as Buffer)).toBe(sha(bytes.banner));
    expect(await onDisk(path.relative(UPLOADS_ROOT, attachmentPath))).toBe(true);
  });

  it("rollback never deletes the only copy: a missing legacy file is restored, a damaged object is refused", async () => {
    const goalName = path.relative("uploads", goalPath);
    const goalKey = async () => (await apply()).moved.find((entry) => entry.purpose === "goal-image")!.key;

    let key = await goalKey();
    await fs.rm(path.join(UPLOADS_ROOT, goalName));
    expect(await rollbackLegacyMove([key])).toEqual({ removed: 1, restored: 1, refused: [], skipped: 0, retried: 0, pendingCleanup: [] });
    expect(sha(await fs.readFile(path.join(UPLOADS_ROOT, goalName)))).toBe(sha(bytes.goal));

    key = await goalKey();
    await fs.rm(path.join(UPLOADS_ROOT, goalName));
    await fs.writeFile(objectPath(key), Buffer.from("damaged"));
    expect(await rollbackLegacyMove([key])).toEqual({ removed: 0, restored: 0, refused: [key], skipped: 0, retried: 0, pendingCleanup: [] });
    expect(await db.select().from(storageObjects).where(eq(storageObjects.key, key))).toHaveLength(1);
    // Leave the goal as a legacy file again for the erasure case below.
    await db.delete(storageObjects).where(eq(storageObjects.key, key));
    await writeLegacy(goalName, bytes.goal);
  });

  it("erasure after a move removes the stored object and the legacy copy", async () => {
    await writeLegacy(bannerUrl.slice("/uploads/".length), bytes.banner);
    await apply();
    const targets = await withTransaction(async (tx) => [
      ...(await collectHouseholdUploadPaths(tx, owner.householdId)),
      ...(await collectUserUploadPaths(tx, owner.userId, owner.householdId)),
    ]);
    // The household manifest names the banner too; the purge list holds each name once.
    expect(new Set(targets.filter((target) => target.key).map((target) => target.name)).size).toBe(3);
    const ids = await withTransaction((tx) => recordPurgeItems(tx, targets));
    expect(await drainErasurePurgeItems(ids)).toEqual([]);
    expect(await db.select().from(storageObjects).where(inArray(storageObjects.householdId, [owner.householdId]))).toEqual([]);
    expect(await storedBytes(bannerUrl)).toBeNull();
    expect(await onDisk(bannerUrl.slice("/uploads/".length))).toBe(false);
    expect(await onDisk(path.relative("uploads", goalPath))).toBe(false);
    expect(await onDisk(path.relative(UPLOADS_ROOT, attachmentPath))).toBe(false);
  });
});
