/**
 * NEW-39 (part): no receipt response exposes a server filesystem path. A real
 * PNG is uploaded over HTTP into real Postgres, then every receipt response is
 * serialized and searched for the stored path, the thumbnail path, the stored
 * filename and the upload directory. List and detail must carry exactly the
 * ReceiptDto allow-list, and the image URLs they name must be served.
 */
import { randomUUID } from "node:crypto";
import * as fs from "fs/promises";
import * as path from "path";
import request from "supertest";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { pendingReceipts, type PendingReceipt } from "@shared/schema";
import { RECEIPT_DTO_KEYS } from "@shared/receipt-dto";
import { db } from "../../../db";
import { removeStoredUnder } from "../../../__tests__/stored-upload-fixture";
import { removeUploadObject } from "../../../core/storage/upload-objects";
import { createSignedHousehold, insertAccount, type SignedHousehold } from "../../../__tests__/signed-household-fixture";
import { a, b, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwUMMAYAj4IP8cvlVgcAAAAASUVORK5CYII=",
  "base64",
);
const owner = () => actors.get("owner")!;
const call = (method: "get" | "post" | "delete", url: string) => request(app)[method](url).set("Cookie", owner().cookie)
  .set("X-Capital-Subject", owner().id).set("X-Capital-Household", a);

async function clean() {
  await db.delete(pendingReceipts).where(inArray(pendingReceipts.householdId, [a, b]));
  await removeStoredUnder(`receipts/${a}/`);
  await fs.rm(path.resolve(process.cwd(), "uploads", "receipts", a), { recursive: true, force: true });
}
async function upload(name = "synthetic-receipt.png", image = PNG) {
  const response = await call("post", "/api/receipts/upload").attach("file", image, { filename: name, contentType: "image/png" }).expect(201);
  const [row] = await db.select().from(pendingReceipts).where(eq(pendingReceipts.id, response.body.data.receiptId));
  return { response, row };
}
/** Every string that would reveal where or under what name the file is stored. */
function secrets(row: PendingReceipt): string[] {
  const values = [row.storagePath, row.thumbnailPath, row.filename].filter((value): value is string => Boolean(value));
  return [...new Set(values.flatMap(value => [value, value.replace(/\\/g, "/"), value.replace(/\\/g, "\\\\")]))];
}
function expectNoPath(body: unknown, row: PendingReceipt) {
  const text = JSON.stringify(body);
  for (const secret of secrets(row)) expect(text).not.toContain(secret);
  expect(text).not.toMatch(/uploads[\\/]+receipts/);
  expect(text).not.toMatch(/storagePath|thumbnailPath|storage_path|thumbnail_path/);
}
function expectDto(dto: Record<string, unknown>, row: PendingReceipt) {
  expect(Object.keys(dto).sort()).toEqual([...RECEIPT_DTO_KEYS].sort());
  expect(dto).toMatchObject({ id: row.id, originalFilename: "synthetic-receipt.png", mimeType: row.mimeType, size: row.size,
    imageUrl: `/api/receipts/${row.id}/ocr-image`, thumbnailUrl: row.thumbnailPath ? `/api/receipts/${row.id}/thumbnail` : null });
}

describe("NEW-39 receipt responses never expose server filesystem paths", () => {
  beforeAll(async () => { await start(); }, 30_000);
  beforeEach(async () => { await clean(); await reset(); });
  afterEach(clean);
  afterAll(async () => { await clean(); await stop(); });

  it("list and detail return exactly the allow-list, and the URLs they name are served", async () => {
    const { response, row } = await upload();
    expect(row.storagePath).toBeTruthy();
    expectNoPath(response.body, row);

    const list = await call("get", "/api/receipts?status=all").expect(200);
    expectNoPath(list.body, row);
    expect(list.body.data).toHaveLength(1);
    expectDto(list.body.data[0], row);

    const detail = await call("get", `/api/receipts/${row.id}`).expect(200);
    expectNoPath(detail.body, row);
    expectDto(detail.body.data, row);

    await call("get", detail.body.data.imageUrl).expect(200);
    if (detail.body.data.thumbnailUrl) await call("get", detail.body.data.thumbnailUrl).expect(200);
  });

  it("upload replay, OCR results, retry, match and delete carry no path", async () => {
    const { row } = await upload();
    const replay = await call("post", "/api/receipts/upload").attach("file", PNG, { filename: "synthetic-receipt.png", contentType: "image/png" }).expect(201);
    expectNoPath(replay.body, row);

    const ocr = await call("post", `/api/receipts/${row.id}/ocr-results`)
      .send({ merchantName: "Synthetic store", amount: "11.11", date: "2026-10-05", confidence: 0.9 }).expect(200);
    expectNoPath(ocr.body, row);
    const retry = await call("post", `/api/receipts/${row.id}/retry-match`).send({});
    expectNoPath(retry.body, row);
    const match = await call("post", `/api/receipts/${row.id}/match`).send({ transactionId: ids.sharedTx, skipAmountValidation: true });
    expectNoPath(match.body, row);

    // A different image, so duplicate detection does not return the first receipt.
    const red = await sharp({ create: { width: 3, height: 3, channels: 3, background: { r: 200, g: 10, b: 10 } } }).png().toBuffer();
    const second = await upload("second-receipt.png", red);
    expect(second.row.id).not.toBe(row.id);
    const removed = await call("delete", `/api/receipts/${second.row.id}`);
    expectNoPath(removed.body, second.row);
    const after = await call("get", `/api/receipts/${row.id}`);
    expectNoPath(after.body, row);
  });

  it("an error for a missing receipt image names no path", async () => {
    const { row } = await upload();
    await removeUploadObject(row.storagePath);
    const missing = await call("get", `/api/receipts/${row.id}/ocr-image`).expect(404);
    expectNoPath(missing.body, row);
  });
});

// Conversion records are immutable evidence that only a household delete removes, so the
// create-transaction response is checked in a household of its own.
describe("NEW-39 create-transaction response carries no path", () => {
  let fx: SignedHousehold;
  beforeAll(async () => { fx = await createSignedHousehold("new39-receipt-paths"); }, 30_000);
  afterAll(async () => { if (fx) await fx.cleanup(undefined, true); });

  it("converting a receipt and reading it back name no stored path", async () => {
    const accountId = await insertAccount(fx);
    const [row] = await db.insert(pendingReceipts).values({
      householdId: fx.householdId, uploadedBy: fx.userId, filename: `${randomUUID()}.png`, originalFilename: "synthetic-receipt.png",
      mimeType: "image/png", size: 1024, storagePath: `uploads/receipts/${fx.householdId}/${randomUUID()}.png`,
    }).returning();
    const converted = await request(fx.app).post(`/api/receipts/${row.id}/create-transaction`).set(fx.headers)
      .send({ accountId, name: "Synthetic receipt vendor", amount: "12.50", date: "2026-10-05" }).expect(201);
    expectNoPath(converted.body, row);
    const detail = await request(fx.app).get(`/api/receipts/${row.id}`).set(fx.headers).expect(200);
    expectNoPath(detail.body, row);
    expectDto(detail.body.data, row);
  });
});
