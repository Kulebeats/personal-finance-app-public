/**
 * NEW-32: attachment upload and delete are audited inside their database
 * transaction (Rule 9). REAL HTTP, REAL DB.
 *
 * The rows carry ids, mime type and size only: never the original file name.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { transactionAttachments, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { isStored, storedNamesUnder } from "../../../__tests__/stored-upload-fixture";
import { removeUploadObject } from "../../../core/storage/upload-objects";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const SECRET_NAME = "PRIVATE-NAME-medical-bill.png";
const signed = (call: request.Test) => call.set("Cookie", actors.get("owner")!.cookie)
  .set("X-Capital-Subject", actors.get("owner")!.id).set("X-Capital-Household", a);

let transactionId: string;
let privateTransactionId: string;
const storedPaths: string[] = [];

const upload = (id: string, name = SECRET_NAME) => signed(request(app).post(`/api/transactions/${id}/attachments`))
  .attach("file", PNG, { filename: name, contentType: "image/png" });
const auditRows = async (entityId: string) =>
  (await pool.query("select * from audit_logs where entity_type='transaction_attachment' and entity_id=$1 order by created_at, id", [entityId])).rows;
const attachmentCount = async () =>
  (await db.select({ id: transactionAttachments.id }).from(transactionAttachments).where(inArray(transactionAttachments.transactionId, [transactionId, privateTransactionId]))).length;

async function clean() {
  await db.delete(transactionAttachments).where(inArray(transactionAttachments.transactionId, [transactionId ?? randomUUID(), privateTransactionId ?? randomUUID()]));
  await db.delete(transactions).where(eq(transactions.householdId, a));
  await pool.query("delete from audit_logs where household_id=$1 or entity_type='transaction_attachment'", [a]);
  for (const path of storedPaths.splice(0)) await removeUploadObject(path);
}

describe("NEW-32 transaction attachment audit (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    transactionId = randomUUID(); privateTransactionId = randomUUID();
    await db.insert(transactions).values([
      { id: transactionId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
        date: "2026-11-10", name: "Attachment audit", amount: "10.00", type: "expense", isPrivate: false },
      { id: privateTransactionId, householdId: a, accountId: ids.privateAccount, ownerUserId: actors.get("owner")!.id,
        date: "2026-11-10", name: "Private attachment audit", amount: "10.00", type: "expense", isPrivate: false },
    ]);
  });
  afterAll(async () => {
    await pool.query("drop trigger if exists block_attachment_audit on audit_logs");
    await pool.query("drop function if exists block_attachment_audit()");
    await clean();
    await stop();
  });

  it("audits an upload with the attachment id, transaction, mime type and size but not the file name", async () => {
    const res = await upload(transactionId).expect(201);
    const attachmentId = res.body.data.id as string;
    const [stored] = await db.select().from(transactionAttachments).where(eq(transactionAttachments.id, attachmentId));
    storedPaths.push(stored.storagePath);

    const [row, ...rest] = await auditRows(attachmentId);
    expect(rest).toHaveLength(0);
    expect(row.action).toBe("CREATE");
    expect(row.household_id).toBe(a);
    expect(row.user_id).toBe(actors.get("owner")!.id);
    expect(row.details.newValue).toMatchObject({ transactionId, mimeType: "image/png", size: PNG.length });
    expect(JSON.stringify(row.details)).not.toContain("PRIVATE-NAME");
  });

  it("audits a delete and removes the stored file", async () => {
    const created = await upload(transactionId).expect(201);
    const attachmentId = created.body.data.id as string;
    const [stored] = await db.select().from(transactionAttachments).where(eq(transactionAttachments.id, attachmentId));

    await signed(request(app).delete(`/api/transactions/${transactionId}/attachments/${attachmentId}`)).expect(200);

    const rows = await auditRows(attachmentId);
    expect(rows.map((row) => row.action)).toEqual(["CREATE", "DELETE"]);
    expect(rows[1].user_id).toBe(actors.get("owner")!.id);
    expect(rows[1].details.oldValue).toMatchObject({ transactionId, mimeType: "image/png" });
    expect(await attachmentCount()).toBe(0);
    expect(await isStored(stored.storagePath)).toBe(false);
  });

  it("keeps the audit row of an attachment on a private account out of the household", async () => {
    const res = await upload(privateTransactionId).expect(201);
    const [stored] = await db.select().from(transactionAttachments).where(eq(transactionAttachments.id, res.body.data.id));
    storedPaths.push(stored.storagePath);
    const [row] = await auditRows(res.body.data.id);
    expect(row.household_id).toBeNull();
  });

  it("leaves no attachment, no audit row and no stored file when the audit insert fails on upload", async () => {
    await pool.query(`create or replace function block_attachment_audit() returns trigger language plpgsql as $$
      begin
        if new.entity_type = 'transaction_attachment' then raise exception 'audit blocked for test'; end if;
        return new;
      end $$`);
    await pool.query("create trigger block_attachment_audit before insert on audit_logs for each row execute function block_attachment_audit()");
    try {
      const res = await upload(transactionId);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await attachmentCount()).toBe(0);
      expect(await storedNamesUnder(`transactions/${transactionId}/`)).toEqual([]);
      const dir = `${process.cwd()}/uploads/transactions/${transactionId}`;
      const left = await fs.readdir(dir).catch(() => [] as string[]);
      expect(left).toEqual([]);
    } finally {
      await pool.query("drop trigger if exists block_attachment_audit on audit_logs");
    }
  });

  it("keeps the attachment and its file when the audit insert fails on delete", async () => {
    const created = await upload(transactionId).expect(201);
    const attachmentId = created.body.data.id as string;
    const [stored] = await db.select().from(transactionAttachments).where(eq(transactionAttachments.id, attachmentId));
    storedPaths.push(stored.storagePath);
    await pool.query(`create or replace function block_attachment_audit() returns trigger language plpgsql as $$
      begin
        if new.entity_type = 'transaction_attachment' and new.action = 'DELETE' then raise exception 'audit blocked for test'; end if;
        return new;
      end $$`);
    await pool.query("create trigger block_attachment_audit before insert on audit_logs for each row execute function block_attachment_audit()");
    try {
      const res = await signed(request(app).delete(`/api/transactions/${transactionId}/attachments/${attachmentId}`));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await attachmentCount()).toBe(1);
      expect(await isStored(stored.storagePath)).toBe(true);
      expect((await auditRows(attachmentId)).map((row) => row.action)).toEqual(["CREATE"]);
    } finally {
      await pool.query("drop trigger if exists block_attachment_audit on audit_logs");
    }
  });
});
