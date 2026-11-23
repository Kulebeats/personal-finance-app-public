/**
 * OPS-001 (R15.3/R19.1): every upload writer stores its bytes in the
 * ObjectStore with a manifest row, never under `<cwd>/uploads` (the container's
 * ephemeral disk), and every reader returns only manifest-checked bytes.
 *
 * Real HTTP into the real app and real Postgres; the store is the local-disk
 * driver under STORAGE_LOCAL_DIR. Each writer is exercised: banner, profile
 * picture, goal image, receipt (+ thumbnail), transaction attachment, merchant
 * logo. Reads: the authenticated /uploads handler, receipt image/thumbnail and
 * attachment download. A tampered object is refused, not served; a deleted
 * one leaves neither object nor manifest row.
 */
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { goalImageUploads, merchantLogoUploads, merchants, pendingReceipts, storageObjects, transactionAttachments, transactions, users } from "@shared/schema";
import { db } from "../../db";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../__tests__/signed-household-fixture";
import { resolveObjectStoreConfiguration } from "../storage/runtime";
import { uploadNameOf } from "../storage/upload-objects";

const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

let owner: SignedHousehold;
let other: SignedHousehold;
let accountId: string;
let merchantId: string;

async function png(seed: number): Promise<Buffer> {
  return sharp({ create: { width: 40 + seed, height: 30, channels: 3, background: { r: seed * 7 % 255, g: 90, b: 160 } } }).png().toBuffer();
}
const as = (fixture: SignedHousehold, test: request.Test) => test.set(fixture.headers);

async function manifestFor(stored: string) {
  const name = uploadNameOf(stored);
  expect(name).not.toBeNull();
  const [row] = await db.select().from(storageObjects).where(eq(storageObjects.uploadName, name!));
  return row;
}
async function onLegacyDisk(stored: string): Promise<boolean> {
  const name = uploadNameOf(stored)!;
  return fs.access(path.join(UPLOADS_ROOT, ...name.split("/"))).then(() => true, () => false);
}
function objectFile(key: string): string {
  const configuration = resolveObjectStoreConfiguration(process.env);
  if (configuration.driver !== "local") throw new Error("this suite runs on the local-disk driver");
  return path.join(configuration.root, ...key.split("/"));
}
async function expectStored(stored: string, purpose: string, bytes?: Buffer) {
  const row = await manifestFor(stored);
  expect(row, `manifest row for ${stored}`).toBeDefined();
  expect(row).toMatchObject({ householdId: owner.householdId, purpose, createdBy: owner.userId });
  expect(row.key).toMatch(new RegExp(`^v1/${purpose}/[0-9a-f-]{36}$`));
  expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
  if (bytes) expect(row.sha256).toBe(sha(bytes));
  const objectBytes = await fs.readFile(objectFile(row.key));
  expect(sha(objectBytes)).toBe(row.sha256);
  expect(row.size).toBe(objectBytes.length);
  expect(await onLegacyDisk(stored)).toBe(false);
  return row;
}

beforeAll(async () => {
  owner = await createSignedHousehold("ops001-owner");
  other = await createSignedHousehold("ops001-other");
  accountId = await insertAccount(owner);
  merchantId = randomUUID();
  await db.insert(merchants).values({ id: merchantId, householdId: owner.householdId, name: "Synthetic logo merchant" });
}, 60_000);

afterAll(async () => {
  const rows = await db.select().from(storageObjects).where(inArray(storageObjects.householdId, [owner.householdId, other.householdId]));
  for (const row of rows) {
    await fs.rm(objectFile(row.key), { force: true });
    await fs.rm(`${objectFile(row.key)}.json`, { force: true });
  }
  await owner?.cleanup(async () => {
    await db.delete(pendingReceipts).where(eq(pendingReceipts.householdId, owner.householdId));
    await db.delete(goalImageUploads).where(eq(goalImageUploads.householdId, owner.householdId));
    await db.update(users).set({ bannerUrl: null, profilePictureUrl: null }).where(eq(users.id, owner.userId));
  });
  await other?.cleanup();
}, 60_000);

describe("OPS-001 uploads live in the ObjectStore with a manifest", () => {
  it("banner: stored with checksum, served to its household only, refused when tampered, gone after delete", async () => {
    const bytes = await png(1);
    const upload = await as(owner, request(owner.app).post("/api/settings/profile/banner"))
      .attach("banner", bytes, { filename: "banner.png", contentType: "image/png" }).expect(200);
    const bannerUrl: string = upload.body.data.bannerUrl;
    const row = await expectStored(bannerUrl, "banner", bytes);

    const served = await as(owner, request(owner.app).get(bannerUrl)).buffer(true).expect(200);
    expect(sha(served.body as Buffer)).toBe(row.sha256);
    expect(served.headers["content-type"]).toMatch(/^image\/png/);
    await as(other, request(other.app).get(bannerUrl)).expect(403);

    // Tamper with the object on disk: the reader refuses it instead of serving it.
    const file = objectFile(row.key);
    const original = await fs.readFile(file);
    await fs.writeFile(file, Buffer.concat([original, Buffer.from("x")]));
    const tampered = await as(owner, request(owner.app).get(bannerUrl)).expect(500);
    expect(tampered.body.error.code).toBe("STORAGE_INTEGRITY");
    await fs.writeFile(file, original);

    await as(owner, request(owner.app).delete("/api/settings/profile/banner")).expect(200);
    expect(await manifestFor(bannerUrl)).toBeUndefined();
    await expect(fs.access(file)).rejects.toThrow();
    await as(owner, request(owner.app).get(bannerUrl)).expect(404);
  });

  it("profile picture and goal image are stored with a manifest and served", async () => {
    const picture = await png(2);
    const pictureResponse = await as(owner, request(owner.app).post("/api/settings/profile/picture"))
      .attach("picture", picture, { filename: "me.png", contentType: "image/png" }).expect(200);
    const pictureUrl: string = pictureResponse.body.data.pictureUrl;
    await expectStored(pictureUrl, "profile-picture", picture);
    await as(owner, request(owner.app).get(pictureUrl)).expect(200);

    const goalImage = await png(3);
    const goalResponse = await as(owner, request(owner.app).post("/api/goals/images"))
      .attach("file", goalImage, { filename: "goal.png", contentType: "image/png" }).expect(201);
    const goalUrl: string = goalResponse.body.data.image.url;
    const [uploadRow] = await db.select().from(goalImageUploads).where(eq(goalImageUploads.id, goalResponse.body.data.image.id));
    expect(uploadNameOf(uploadRow.filePath)).toBe(uploadNameOf(goalUrl));
    await expectStored(goalUrl, "goal-image", goalImage);
    const served = await as(owner, request(owner.app).get(goalUrl)).buffer(true).expect(200);
    expect(sha(served.body as Buffer)).toBe(sha(goalImage));
  });

  it("receipt image and thumbnail are stored objects, served by the receipt routes, removed on delete", async () => {
    const upload = await as(owner, request(owner.app).post("/api/receipts/upload"))
      .attach("file", await png(4), { filename: "receipt.png", contentType: "image/png" }).expect(201);
    const receiptId: string = upload.body.data.receiptId;
    const [receipt] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, receiptId));
    const image = await expectStored(receipt.storagePath, "receipt");
    const thumbnail = await expectStored(receipt.thumbnailPath!, "receipt-thumbnail");

    const served = await as(owner, request(owner.app).get(`/api/receipts/${receiptId}/ocr-image`)).buffer(true).expect(200);
    expect(sha(served.body as Buffer)).toBe(image.sha256);
    const thumb = await as(owner, request(owner.app).get(`/api/receipts/${receiptId}/thumbnail`)).buffer(true).expect(200);
    expect(sha(thumb.body as Buffer)).toBe(thumbnail.sha256);
    await as(other, request(other.app).get(`/api/receipts/${receiptId}/ocr-image`)).expect(404);

    await as(owner, request(owner.app).delete(`/api/receipts/${receiptId}`)).expect(200);
    expect(await manifestFor(receipt.storagePath)).toBeUndefined();
    expect(await manifestFor(receipt.thumbnailPath!)).toBeUndefined();
    await expect(fs.access(objectFile(image.key))).rejects.toThrow();
  });

  it("transaction attachment is a stored object, downloaded with its checksum, removed on delete", async () => {
    const transactionId = randomUUID();
    await db.insert(transactions).values({ id: transactionId, householdId: owner.householdId, accountId, ownerUserId: owner.userId,
      date: "2026-11-10", name: "Synthetic attachment purchase", amount: "10.00", type: "expense", isPrivate: false });
    const bytes = await png(5);
    const upload = await as(owner, request(owner.app).post(`/api/transactions/${transactionId}/attachments`))
      .attach("file", bytes, { filename: "slip.png", contentType: "image/png" }).expect(201);
    const attachmentId: string = upload.body.data.id;
    const [row] = await db.select().from(transactionAttachments).where(eq(transactionAttachments.id, attachmentId));
    const stored = await expectStored(row.storagePath, "attachment", bytes);
    const tempDir = path.join(UPLOADS_ROOT, "temp");
    const leftovers = await fs.readdir(tempDir).catch(() => [] as string[]);
    expect(leftovers.filter((file) => file.includes("slip"))).toEqual([]);

    const download = await as(owner, request(owner.app).get(`/api/transactions/${transactionId}/attachments/${attachmentId}/download`))
      .buffer(true).expect(200);
    expect(sha(download.body as Buffer)).toBe(stored.sha256);

    await as(owner, request(owner.app).delete(`/api/transactions/${transactionId}/attachments/${attachmentId}`)).expect(200);
    expect(await manifestFor(row.storagePath)).toBeUndefined();
  });

  it("merchant logo is a stored object served at its logo URL", async () => {
    const upload = await as(owner, request(owner.app).post(`/api/merchants/${merchantId}/logo`))
      .attach("logo", await png(6), { filename: "logo.png", contentType: "image/png" }).expect(200);
    const logoUrl: string = upload.body.data.logoUrl;
    const [logoRow] = await db.select().from(merchantLogoUploads).where(eq(merchantLogoUploads.merchantId, merchantId));
    expect(uploadNameOf(logoRow.filePath)).toBe(uploadNameOf(logoUrl));
    const stored = await expectStored(logoUrl, "merchant-logo");
    const served = await as(owner, request(owner.app).get(logoUrl)).buffer(true).expect(200);
    expect(sha(served.body as Buffer)).toBe(stored.sha256);
  });
});
