/**
 * Rule 11 under concurrency: attachment upload and delete lock the transaction
 * and its account, then re-check visibility on the locked rows, so a privacy
 * change that commits between the first check and the write wins. REAL HTTP,
 * REAL DB, two connections.
 *
 * alice = the fixture's `owner`; bob = `member`. alice makes her transaction
 * private in a second connection that holds its row lock while bob's request
 * runs; bob's request must wait for that lock and then answer 404, writing and
 * deleting nothing and leaving no orphan file.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { transactionAttachments, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const alice = () => actors.get("owner")!;
const asAlice = (call: request.Test) => call.set("Cookie", alice().cookie).set("X-Capital-Subject", alice().id).set("X-Capital-Household", a);
const bob = () => actors.get("member")!;
const asBob = (call: request.Test) => call.set("Cookie", bob().cookie).set("X-Capital-Subject", bob().id).set("X-Capital-Household", a);

let transactionId: string;
let attachmentId: string;
let storagePath: string;
let holder: PoolClient | undefined;
let holderPid = 0;
/** What the request answered, once it has. Printed if the wait is never seen. */
let answered: { status: number; body: unknown } | undefined;

const storedDir = () => path.join(process.cwd(), "uploads", "transactions", transactionId);
const attachmentCount = async () =>
  (await db.select({ id: transactionAttachments.id }).from(transactionAttachments).where(eq(transactionAttachments.transactionId, transactionId))).length;

/** Alice's second connection: privacy flip written but not committed, so the row stays locked. */
async function holdPrivacyFlip() {
  holder = await pool.connect();
  await holder.query("begin");
  holderPid = (await holder.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
  await holder.query("update transactions set is_private = true where id = $1", [transactionId]);
}

/**
 * Wait until some backend is blocked BY the connection holding the flip. This
 * asks Postgres who blocks whom (pg_blocking_pids); it does not read the
 * waiting statement's text, which pg_stat_activity truncates at 1024 bytes and
 * the transactions select (every column) exceeds. On timeout it reports what
 * every other backend was doing and what the request answered.
 */
async function waitUntilBlocked() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const { rowCount } = await pool.query(
      "select 1 from pg_stat_activity where datname = current_database() and $1::int = any(pg_blocking_pids(pid))",
      [holderPid],
    );
    if (rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const { rows } = await pool.query(
    `select pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) as blocked_by, left(query, 160) as query
       from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() order by pid`,
  );
  throw new Error(
    "The request never waited on the transaction lock held by backend " + holderPid +
    ". Request answered: " + JSON.stringify(answered ?? "not yet") +
    ". Backends: " + JSON.stringify(rows),
  );
}

async function releaseFlip() {
  if (!holder) return;
  await holder.query("commit");
  holder.release();
  holder = undefined;
}

describe("attachment upload and delete lock the transaction (Rule 11, real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    answered = undefined;
    await reset();
    transactionId = randomUUID();
    await db.insert(transactions).values({
      id: transactionId, householdId: a, accountId: ids.sharedAccount, ownerUserId: actors.get("owner")!.id,
      date: "2026-11-10", name: "Lock race", amount: "10.00", type: "expense", isPrivate: false,
    });
    await fs.mkdir(storedDir(), { recursive: true });
    storagePath = path.join(storedDir(), `${randomUUID()}.png`);
    await fs.writeFile(storagePath, PNG);
    const [attachment] = await db.insert(transactionAttachments).values({
      transactionId, filename: path.basename(storagePath), originalFilename: "seed.png", mimeType: "image/png",
      size: PNG.length, storagePath, uploadedBy: actors.get("owner")!.id,
    }).returning();
    attachmentId = attachment.id;
  });
  afterEach(async () => {
    if (holder) { await holder.query("rollback").catch(() => undefined); holder.release(); holder = undefined; }
    await db.delete(transactionAttachments).where(eq(transactionAttachments.transactionId, transactionId));
    await db.delete(transactions).where(eq(transactions.id, transactionId));
    await fs.rm(storedDir(), { recursive: true, force: true });
  });
  afterAll(stop);

  it("upload: a privacy change that commits first makes it a 404 with no row and no orphan file", async () => {
    await holdPrivacyFlip();
    const pending = asBob(request(app).post(`/api/transactions/${transactionId}/attachments`))
      .attach("file", PNG, { filename: "late.png", contentType: "image/png" })
      .then((res) => { answered = { status: res.status, body: res.body }; return res; });
    try {
      await waitUntilBlocked();
    } finally {
      await releaseFlip();
    }
    const res = await pending;

    expect(res.status).toBe(404);
    expect(await attachmentCount()).toBe(1);
    expect(await fs.readdir(storedDir())).toEqual([path.basename(storagePath)]);
    const audits = await pool.query("select 1 from audit_logs where entity_type='transaction_attachment' and action='CREATE' and details->'newValue'->>'transactionId' = $1", [transactionId]);
    expect(audits.rowCount).toBe(0);
  });

  it("delete: a privacy change that commits first makes it a 404, and the attachment and its file stay", async () => {
    await holdPrivacyFlip();
    const pending = asBob(request(app).delete(`/api/transactions/${transactionId}/attachments/${attachmentId}`))
      .then((res) => { answered = { status: res.status, body: res.body }; return res; });
    try {
      await waitUntilBlocked();
    } finally {
      await releaseFlip();
    }
    const res = await pending;

    expect(res.status).toBe(404);
    expect(await attachmentCount()).toBe(1);
    await expect(fs.access(storagePath)).resolves.toBeUndefined();
    const audits = await pool.query("select 1 from audit_logs where entity_type='transaction_attachment' and action='DELETE' and entity_id=$1", [attachmentId]);
    expect(audits.rowCount).toBe(0);
  });

  it("an edit of the same transaction running with uploads and deletes never deadlocks (same lock order as the writers)", async () => {
    const rounds = Array.from({ length: 10 }, (_, i) => i);
    const edits = rounds.map((i) => asAlice(request(app).put(`/api/transactions/${transactionId}`)).send({ notes: `edit ${i}` }).then((res) => res));
    const uploads = rounds.map(() => asAlice(request(app).post(`/api/transactions/${transactionId}/attachments`))
      .attach("file", PNG, { filename: "race.png", contentType: "image/png" }).then((res) => res));
    const deletes = rounds.map(() => asAlice(request(app).delete(`/api/transactions/${transactionId}/attachments/${attachmentId}`)).then((res) => res));
    const [editResults, uploadResults, deleteResults] = await Promise.all([Promise.all(edits), Promise.all(uploads), Promise.all(deletes)]);

    // 40P01 (deadlock detected) surfaces as a 5xx; nothing may.
    expect([...editResults, ...uploadResults, ...deleteResults].map((res) => res.status).filter((status) => status >= 500)).toEqual([]);
    expect(editResults.map((res) => res.status)).toEqual(rounds.map(() => 200));
    expect(uploadResults.map((res) => res.status)).toEqual(rounds.map(() => 201));
    // The first delete removes the seeded attachment; the rest find nothing.
    expect(deleteResults.filter((res) => res.status === 200)).toHaveLength(1);
    expect(deleteResults.filter((res) => res.status !== 200).every((res) => res.status === 404)).toBe(true);
  });
});
