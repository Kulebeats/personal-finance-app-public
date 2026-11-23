/**
 * R07.1 / AH-08: self-service personal-data export. Real HTTP against real
 * Postgres. The export is a data_exports row, a stored file only its requester
 * can download, and an audit row written in the same transaction. It holds the
 * requester's own data plus household data they may see, never another
 * member's private account or transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, auditLogs, dataExports, householdMembers, households, transactions, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import * as fs from "fs/promises";
import * as path from "path";
import { personalExportRoot, removePersonalExportFile, writePersonalExportFile } from "../settings.privacy-export.files";
import { PERSONAL_EXPORT_JSON_ENTRY } from "@shared/personal-data-export";
import { readStoredZip } from "./personal-export-archive-reader";

/** The JSON document inside a version 2 export (A-27). */
const exportDocument = (bytes: Buffer) => JSON.parse(readStoredZip(bytes).get(PERSONAL_EXPORT_JSON_ENTRY)!.data.toString("utf8"));

const password = "SyntheticPersonalExport123!";
const householdId = randomUUID();
const ids: string[] = [];
let app: Awaited<ReturnType<typeof getTestApp>>;
type Actor = { id: string; email: string; cookie: string };
let owner: Actor;
let member: Actor;
let leaver: Actor;

function download(actor: Actor, exportId: string) {
  return request(app).get(`/api/settings/privacy/exports/${exportId}/download`).set("Cookie", actor.cookie)
    .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", (c: Buffer) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
}

function downloadAudits(exportId: string) {
  return db.select().from(auditLogs).where(and(
    eq(auditLogs.entityType, "data_export"), eq(auditLogs.entityId, exportId), eq(auditLogs.action, "PROCESS"),
  ));
}

const sharedAccount = randomUUID();
const ownerPrivateAccount = randomUUID();
const memberPrivateAccount = randomUUID();
const sharedTxn = randomUUID();
const ownerPrivateTxnOnShared = randomUUID();
const memberPrivateTxnOnShared = randomUUID();
const memberTxnOnOwnAccount = randomUUID();
const ownerTxnOnPrivateAccount = randomUUID();
const ownerNrc = "611111/11/1";
const memberNrc = "622222/22/2";

async function fixture(role: "owner" | "member"): Promise<Actor> {
  const id = randomUUID();
  const email = `personal-export-${id}@example.invalid`;
  await db.insert(users).values({
    id, email, username: `personal-export-${id}`, passwordHash: await hashPassword(password),
    emailVerified: true, fullName: `Synthetic export ${role}`, phoneNumberMobile: "+260971110000",
    nrc: role === "owner" ? ownerNrc : memberNrc,
  });
  ids.push(id);
  await db.insert(householdMembers).values({ userId: id, householdId, role });
  const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return { id, email, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") };
}

async function stepUp(actor: Actor) {
  await request(app).post("/api/settings/security/step-up").set("Cookie", actor.cookie).send({ password }).expect(200);
}

function requestExport(actor: Actor) {
  return request(app).post("/api/settings/privacy/export").set("Cookie", actor.cookie).send({});
}

describe("R07.1 personal-data export", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic personal export", currency: "ZMW" });
    owner = await fixture("owner");
    member = await fixture("member");
    leaver = await fixture("member");
    const account = { householdId, type: "checking" as const, currency: "ZMW", initialBalance: "0.00", balance: "0.00" };
    await db.insert(accounts).values([
      { ...account, id: sharedAccount, name: "Shared household account", ownerUserId: owner.id, isPrivate: false },
      { ...account, id: ownerPrivateAccount, name: "Owner private account", ownerUserId: owner.id, isPrivate: true },
      { ...account, id: memberPrivateAccount, name: "Member private account", ownerUserId: member.id, isPrivate: true },
    ]);
    const txn = { householdId, type: "expense" as const, currency: "ZMW", date: "2026-10-01" };
    await db.insert(transactions).values([
      { ...txn, id: sharedTxn, accountId: sharedAccount, name: "Shared groceries", amount: "123.45", isPrivate: false },
      { ...txn, id: ownerPrivateTxnOnShared, accountId: sharedAccount, name: "Owner secret gift", amount: "77.70", ownerUserId: owner.id, isPrivate: true },
      { ...txn, id: memberPrivateTxnOnShared, accountId: sharedAccount, name: "Member own private", amount: "10.01", ownerUserId: member.id, isPrivate: true },
      { ...txn, id: memberTxnOnOwnAccount, accountId: memberPrivateAccount, name: "Member account spend", amount: "5.55", ownerUserId: member.id, isPrivate: false },
      { ...txn, id: ownerTxnOnPrivateAccount, accountId: ownerPrivateAccount, name: "Owner private account spend", amount: "9.99", ownerUserId: owner.id, isPrivate: false },
    ]);
  }, 60000);

  afterAll(async () => {
    for (const id of ids) await pool.query("DELETE FROM \"session\" WHERE sess->>'userId' = $1", [id]);
    await db.delete(auditLogs).where(inArray(auditLogs.userId, ids));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    const written = await db.select({ id: dataExports.id }).from(dataExports).where(inArray(dataExports.userId, ids));
    for (const { id } of written) await removePersonalExportFile(id);
    await db.delete(dataExports).where(inArray(dataExports.userId, ids));
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of ids) await db.delete(users).where(eq(users.id, id));
  });

  it("requires a recent step-up and creates nothing without it", async () => {
    const res = await requestExport(member);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("STEP_UP_REQUIRED");
    // This member has no MFA and steps up with a password (staging wording note).
    expect(res.body.error.message).toBe("Please confirm it's you to continue");
    const rows = await db.select().from(dataExports).where(eq(dataExports.userId, member.id));
    expect(rows).toHaveLength(0);
  });

  it("creates a ready export row with manifest parameters and an audit row for it", async () => {
    await stepUp(member);
    const res = await requestExport(member).expect(201);
    const exportId: string = res.body.data.id;
    expect(res.body.data.status).toBe("ready");

    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, exportId));
    // Household-less row: household report exports must never list it.
    expect(row).toMatchObject({ userId: member.id, householdId: null, exportType: "personal_data", fileFormat: "zip", status: "ready" });
    const parameters = row.parameters as Record<string, unknown>;
    expect(parameters.version).toBe(2);
    expect(parameters.householdId).toBe(householdId);
    expect(parameters.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parameters.sizeBytes).toEqual(expect.any(Number));
    expect(parameters.sections).toMatchObject({ accounts: 2, transactions: 3 });
    expect(row.recordCount).toEqual(expect.any(Number));

    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "data_export"), eq(auditLogs.entityId, exportId)));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: member.id, householdId: null, action: "CREATE" });
    expect(JSON.stringify(audits[0].details)).not.toContain("+260971110000");
  });

  it("the requester downloads exactly their own and shared data, matching the recorded checksum", async () => {
    const [row] = await db.select().from(dataExports).where(and(eq(dataExports.userId, member.id), eq(dataExports.exportType, "personal_data")));
    const res = await download(member, row.id).expect(200);
    expect(res.headers["content-type"]).toContain("application/zip");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["cache-control"]).toContain("no-store");
    const bytes = res.body as Buffer;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe((row.parameters as { sha256: string }).sha256);

    const data = exportDocument(bytes);
    expect(data.profile.email).toBe(member.email);
    expect(data.profile.phoneNumberMobile).toBe("+260971110000");
    // AH-07: the requester's NRC is theirs to export; salary range no longer exists.
    expect(data.profile.nrc).toBe(memberNrc);
    expect(bytes.toString("utf8")).not.toContain(ownerNrc);
    expect(data.profile).not.toHaveProperty("salaryRangeEncrypted");
    expect(data.profile).not.toHaveProperty("passwordHash");
    expect(data.profile).not.toHaveProperty("mfaBackupCodes");
    expect(data.memberships).toEqual([expect.objectContaining({ householdId, role: "member" })]);
    expect(data.accounts.map((a: { id: string }) => a.id).sort()).toEqual([sharedAccount, memberPrivateAccount].sort());
    expect(data.transactions.map((t: { id: string }) => t.id).sort())
      .toEqual([sharedTxn, memberPrivateTxnOnShared, memberTxnOnOwnAccount].sort());
    const shared = data.transactions.find((t: { id: string }) => t.id === sharedTxn);
    expect(shared).toMatchObject({ amount: "123.45", currency: "ZMW", date: "2026-10-01" });

    const text = bytes.toString("utf8");
    for (const hidden of [ownerPrivateAccount, ownerPrivateTxnOnShared, ownerTxnOnPrivateAccount, "Owner secret gift", "Owner private account", owner.email]) {
      expect({ hidden, leaked: text.includes(hidden) }).toEqual({ hidden, leaked: false });
    }
    expect(text).not.toContain("passwordHash");

    // The egress is audited: ids, checksum and size only, never the data.
    const audits = await downloadAudits(row.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: member.id, householdId: null });
    expect(audits[0].details).toMatchObject({ event: "download", exportType: "personal_data", sourceHouseholdId: householdId,
      sha256: (row.parameters as { sha256: string }).sha256, sizeBytes: bytes.length });
    expect(JSON.stringify(audits[0].details)).not.toContain("+260971110000");
  });

  it("household owners never see a member's personal export through the report exports", async () => {
    const [row] = await db.select().from(dataExports).where(and(eq(dataExports.userId, member.id), eq(dataExports.exportType, "personal_data")));
    const listed = await request(app).get("/api/reports/exports").set("Cookie", owner.cookie).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain(row.id);
    await request(app).get(`/api/reports/exports/${row.id}`).set("Cookie", owner.cookie).expect(404);
    const ownAudits = await db.select({ id: auditLogs.id }).from(auditLogs)
      .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityId, row.id)));
    expect(ownAudits).toHaveLength(0);
  });

  it("a member who left the household can no longer download an earlier export", async () => {
    await stepUp(leaver);
    const created = await requestExport(leaver).expect(201);
    const exportId: string = created.body.data.id;
    await db.delete(householdMembers).where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, leaver.id)));

    await download(leaver, exportId).expect(404);
    expect(await downloadAudits(exportId)).toHaveLength(0);
    const list = await request(app).get("/api/settings/privacy/exports").set("Cookie", leaver.cookie).expect(200);
    expect(list.body.data[0]).toMatchObject({ id: exportId, status: "revoked", downloadUrl: null });
  });

  it("another member and an anonymous caller cannot download it", async () => {
    const [row] = await db.select().from(dataExports).where(and(eq(dataExports.userId, member.id), eq(dataExports.exportType, "personal_data")));
    await request(app).get(`/api/settings/privacy/exports/${row.id}/download`).set("Cookie", owner.cookie).expect(404);
    await request(app).get(`/api/settings/privacy/exports/${row.id}/download`).expect(401);
    await request(app).get("/api/settings/privacy/exports/not-a-uuid/download").set("Cookie", member.cookie).expect(400);
  });

  it("lists only the caller's own personal exports", async () => {
    const mine = await request(app).get("/api/settings/privacy/exports").set("Cookie", member.cookie).expect(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]).toMatchObject({ status: "ready", fileFormat: "zip" });
    expect(mine.body.data[0].downloadUrl).toContain(`/api/settings/privacy/exports/${mine.body.data[0].id}/download`);
    const theirs = await request(app).get("/api/settings/privacy/exports").set("Cookie", owner.cookie).expect(200);
    expect(theirs.body.data).toHaveLength(0);
  });

  it("an expired export is refused with 410 without waiting on the captured transactions", async () => {
    const [row] = await db.select().from(dataExports).where(and(eq(dataExports.userId, member.id), eq(dataExports.exportType, "personal_data")));
    await pool.query("UPDATE data_exports SET created_at = now() - interval '8 days' WHERE id = $1", [row.id]);
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT id FROM transactions WHERE id=$1 FOR UPDATE", [sharedTxn]);
      await download(member, row.id).timeout(3_000).expect(410);
      const list = await request(app).get("/api/settings/privacy/exports").set("Cookie", member.cookie).expect(200);
      expect(list.body.data[0].status).toBe("expired");
    } finally {
      try { await locker.query("ROLLBACK"); } finally { locker.release(); }
    }
  });

  it("the owner's export holds the owner's private rows and not the member's", async () => {
    await stepUp(owner);
    const res = await requestExport(owner).expect(201);
    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, res.body.data.id));
    expect((row.parameters as { sections: Record<string, number> }).sections).toMatchObject({ accounts: 2, transactions: 3 });
    const dl = await download(owner, row.id).expect(200);
    const data = exportDocument(dl.body as Buffer);
    expect(data.transactions.map((t: { id: string }) => t.id).sort())
      .toEqual([sharedTxn, ownerPrivateTxnOnShared, ownerTxnOnPrivateAccount].sort());
    expect((dl.body as Buffer).toString("utf8")).not.toContain(member.email);
  });

  it("a file that no longer matches its checksum is not served and not audited as released", async () => {
    const [row] = await db.select().from(dataExports).where(and(eq(dataExports.userId, owner.id), eq(dataExports.exportType, "personal_data")));
    const before = (await downloadAudits(row.id)).length;
    await fs.unlink(path.join(personalExportRoot(), `${row.id}.zip`));
    await writePersonalExportFile(row.id, Buffer.from("{\"tampered\":true}"), "zip");
    await download(owner, row.id).expect(404);
    expect(await downloadAudits(row.id)).toHaveLength(before);
  });

  // A-35: membership unchanged, one source account newly private.
  it("an export whose source account became private to someone else reads as revoked", async () => {
    const watcher = await fixture("member");
    const laterPrivateAccount = randomUUID();
    await db.insert(accounts).values({ householdId, id: laterPrivateAccount, name: "Later private account", type: "checking",
      currency: "ZMW", initialBalance: "0.00", balance: "0.00", ownerUserId: owner.id, isPrivate: false });
    await stepUp(watcher);
    const created = await requestExport(watcher).expect(201);
    const exportId: string = created.body.data.id;
    await download(watcher, exportId).expect(200);
    const releasedBefore = (await downloadAudits(exportId)).length;

    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, laterPrivateAccount));
    const [membership] = await db.select({ role: householdMembers.role }).from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, watcher.id)));
    expect(membership).toEqual({ role: "member" });

    await download(watcher, exportId).expect(404);
    expect(await downloadAudits(exportId)).toHaveLength(releasedBefore);
    const list = await request(app).get("/api/settings/privacy/exports").set("Cookie", watcher.cookie).expect(200);
    expect(list.body.data[0]).toMatchObject({ id: exportId, status: "revoked", downloadUrl: null });
  });

  it("revokes an export when a captured transaction becomes private on a still-shared account", async () => {
    const watcher = await fixture("member");
    const transactionId = randomUUID();
    const unrelatedId = randomUUID();
    const base = { householdId, accountId: sharedAccount, ownerUserId: owner.id, type: "expense" as const,
      currency: "ZMW", date: "2026-10-01", amount: "42.35" };
    await db.insert(transactions).values([
      { ...base, id: transactionId, name: "Captured independent privacy", isPrivate: false },
      { ...base, id: unrelatedId, name: "Uncaptured private transaction", isPrivate: true },
    ]);
    await stepUp(watcher);
    const created = await requestExport(watcher).expect(201);
    const exportId: string = created.body.data.id;
    const original = await download(watcher, exportId).expect(200);
    const originalBytes = (original.body as Buffer).toString("utf8");
    expect(originalBytes).toContain(transactionId);
    expect(originalBytes).not.toContain(unrelatedId);
    await db.update(transactions).set({ isPrivate: false }).where(eq(transactions.id, unrelatedId));
    await download(watcher, exportId).expect(200);
    const releasedBefore = (await downloadAudits(exportId)).length;

    await db.update(transactions).set({ isPrivate: true }).where(eq(transactions.id, transactionId));
    const [account] = await db.select({ isPrivate: accounts.isPrivate }).from(accounts).where(eq(accounts.id, sharedAccount));
    expect(account).toEqual({ isPrivate: false });
    await download(watcher, exportId).expect(404);
    expect(await downloadAudits(exportId)).toHaveLength(releasedBefore);
    const list = await request(app).get("/api/settings/privacy/exports").set("Cookie", watcher.cookie).expect(200);
    expect(list.body.data[0]).toMatchObject({ id: exportId, status: "revoked", downloadUrl: null });
    const [stored] = await db.select({ parameters: dataExports.parameters }).from(dataExports)
      .where(eq(dataExports.id, exportId));
    const manifest = stored.parameters as { sourceTransactionIds: string[] };
    expect(manifest.sourceTransactionIds).toContain(transactionId);
    expect(manifest.sourceTransactionIds).not.toContain(unrelatedId);
  });

  it("revokes a household manifest carrying account evidence but no transaction evidence", async () => {
    const watcher = await fixture("member");
    await stepUp(watcher);
    const created = await requestExport(watcher).expect(201);
    const exportId: string = created.body.data.id;
    const [stored] = await db.select({ parameters: dataExports.parameters }).from(dataExports)
      .where(eq(dataExports.id, exportId));
    const { sourceTransactionIds: _omitted, ...legacy } = stored.parameters as Record<string, unknown>;
    await db.update(dataExports).set({ parameters: legacy }).where(eq(dataExports.id, exportId));

    await download(watcher, exportId).expect(404);
    expect(await downloadAudits(exportId)).toHaveLength(0);
    const list = await request(app).get("/api/settings/privacy/exports").set("Cookie", watcher.cookie).expect(200);
    expect(list.body.data[0]).toMatchObject({ id: exportId, status: "revoked", downloadUrl: null });
  });
});
