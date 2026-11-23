/**
 * Rule 11: every transaction-attachment route resolves the transaction with the
 * same visibility rule the transaction list uses. A private transaction, or any
 * transaction on a private account, is visible only to its owner, and to anyone
 * else it is a 404 exactly like a transaction that does not exist. REAL HTTP,
 * REAL DB.
 *
 * alice = the fixture's `owner` (owns the private account), bob = `member`.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { transactionAttachments, transactions } from "@shared/schema";
import { db } from "../../../db";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
type Person = "owner" | "member";
const alice: Person = "owner";
const bob: Person = "member";

const as = (who: Person, call: request.Test) => call.set("Cookie", actors.get(who)!.cookie)
  .set("X-Capital-Subject", actors.get(who)!.id).set("X-Capital-Household", a);

interface Fixture { transactionId: string; attachmentId: string; storagePath: string }
let privateTxn: Fixture;       // is_private = true, on a shared account
let onPrivateAccount: Fixture; // is_private = false, on alice's private account
let sharedTxn: Fixture;

async function seedAttachment(accountId: string, isPrivate: boolean, name: string): Promise<Fixture> {
  const transactionId = randomUUID();
  await db.insert(transactions).values({
    id: transactionId, householdId: a, accountId, ownerUserId: actors.get(alice)!.id,
    date: "2026-11-10", name, amount: "10.00", type: "expense", isPrivate,
  });
  const dir = path.join(process.cwd(), "uploads", "transactions", transactionId);
  await fs.mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, `${randomUUID()}.png`);
  await fs.writeFile(storagePath, PNG);
  const [attachment] = await db.insert(transactionAttachments).values({
    transactionId, filename: path.basename(storagePath), originalFilename: "seed.png", mimeType: "image/png",
    size: PNG.length, storagePath, uploadedBy: actors.get(alice)!.id,
  }).returning();
  return { transactionId, attachmentId: attachment.id, storagePath };
}

const list = (who: Person, f: Fixture) => as(who, request(app).get(`/api/transactions/${f.transactionId}/attachments`));
const download = (who: Person, f: Fixture) => as(who, request(app).get(`/api/transactions/${f.transactionId}/attachments/${f.attachmentId}/download`));
const upload = (who: Person, f: Fixture) => as(who, request(app).post(`/api/transactions/${f.transactionId}/attachments`))
  .attach("file", PNG, { filename: "new.png", contentType: "image/png" });
const remove = (who: Person, f: Fixture) => as(who, request(app).delete(`/api/transactions/${f.transactionId}/attachments/${f.attachmentId}`));
const attachmentCount = async (f: Fixture) =>
  (await db.select({ id: transactionAttachments.id }).from(transactionAttachments).where(eq(transactionAttachments.transactionId, f.transactionId))).length;

async function clean() {
  const txIds = [privateTxn, onPrivateAccount, sharedTxn].filter(Boolean).map((f) => f.transactionId);
  if (txIds.length) await db.delete(transactionAttachments).where(inArray(transactionAttachments.transactionId, txIds));
  await db.delete(transactions).where(eq(transactions.householdId, a));
  for (const id of txIds) await fs.rm(path.join(process.cwd(), "uploads", "transactions", id), { recursive: true, force: true });
}

describe("transaction attachments follow transaction visibility (Rule 11, real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    privateTxn = await seedAttachment(ids.sharedAccount, true, "Alice private txn");
    onPrivateAccount = await seedAttachment(ids.privateAccount, false, "On alice's private account");
    sharedTxn = await seedAttachment(ids.sharedAccount, false, "Shared txn");
  });
  afterAll(async () => { await clean(); await stop(); });

  describe.each([
    ["a private transaction", () => privateTxn],
    ["a transaction on a private account", () => onPrivateAccount],
  ])("%s of alice, seen by bob", (_label, fixture) => {
    it("is a 404 on list, download, upload and delete, and nothing changes", async () => {
      const f = fixture();
      expect((await list(bob, f)).status).toBe(404);
      expect((await download(bob, f)).status).toBe(404);
      expect((await upload(bob, f)).status).toBe(404);
      expect((await remove(bob, f)).status).toBe(404);

      expect(await attachmentCount(f)).toBe(1);
      await expect(fs.access(f.storagePath)).resolves.toBeUndefined();
      expect(await fs.readdir(path.dirname(f.storagePath))).toHaveLength(1);
    });

    it("answers exactly like a transaction that does not exist (no 403 that confirms it)", async () => {
      const f = fixture();
      const missing: Fixture = { transactionId: randomUUID(), attachmentId: randomUUID(), storagePath: "" };
      for (const call of [list, download, upload, remove]) {
        const hidden = await call(bob, f);
        const absent = await call(bob, missing);
        expect(hidden.status).toBe(404);
        expect(absent.status).toBe(404);
      }
    });

    it("still works for alice: list, download, upload and delete", async () => {
      const f = fixture();
      expect((await list(alice, f)).status).toBe(200);
      expect((await download(alice, f)).status).toBe(200);
      const uploaded = await upload(alice, f);
      expect(uploaded.status).toBe(201);
      expect((await remove(alice, f)).status).toBe(200);
      expect((await remove(alice, { ...f, attachmentId: uploaded.body.data.id })).status).toBe(200);
      expect(await attachmentCount(f)).toBe(0);
    });
  });

  it("an attachment on a shared transaction works for both members", async () => {
    for (const who of [alice, bob]) {
      const listed = await list(who, sharedTxn);
      expect(listed.status).toBe(200);
      expect(listed.body.data).toHaveLength(1);
      expect((await download(who, sharedTxn)).status).toBe(200);
    }
  });

  it("a guessed file URL under /uploads cannot bypass the check", async () => {
    for (const f of [privateTxn, onPrivateAccount, sharedTxn]) {
      const url = `/uploads/transactions/${f.transactionId}/${path.basename(f.storagePath)}`;
      for (const who of [alice, bob]) {
        expect((await as(who, request(app).get(url))).status).toBe(403);
      }
    }
  });
});
