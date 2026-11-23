import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, auditLogs, holdings, householdMembers, households, investmentOpeningOperationReceipts,
  investmentTransactions, securities, taxLots, userSessions, users } from "@shared/schema";
import { db, pool } from "../../db";
import { getTestApp } from "../../__tests__/fixtures";
import { hashPassword } from "../../auth";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";

const password = "SyntheticOpeningErase123!";
let app: Awaited<ReturnType<typeof getTestApp>>, passwordHash: string;
let householdId: string, historicalHouseholdId: string, subjectId: string, peerId: string, historicalPeerId: string;
let accountId: string, historicalAccountId: string, securityId: string;
let subjectEmail: string, subjectCookie: string, peerCookie: string;
const userIds = () => [subjectId, peerId, historicalPeerId];
const hhIds = () => [householdId, historicalHouseholdId];
function opening(operationId: string, cookie = subjectCookie, custody = accountId) {
  return request(app).post("/api/investments/holdings").set("Cookie", cookie).send({ operationId, expectedCurrency: "ZMW",
    accountId: custody, securityId, quantity: "2", costBasis: "100", acquiredDate: "2031-01-20" });
}
async function financial() {
  return {
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, hhIds())).orderBy(accounts.id),
    holdings: await db.select().from(holdings).where(inArray(holdings.householdId, hhIds())).orderBy(holdings.id),
    purchases: await db.select().from(investmentTransactions).where(inArray(investmentTransactions.householdId, hhIds())).orderBy(investmentTransactions.id),
    lots: await db.select().from(taxLots).where(inArray(taxLots.householdId, hhIds())).orderBy(taxLots.id),
    audits: await db.select().from(auditLogs).where(inArray(auditLogs.userId, userIds())).orderBy(auditLogs.id),
  };
}
async function receipts() {
  return db.select().from(investmentOpeningOperationReceipts).where(inArray(investmentOpeningOperationReceipts.householdId, hhIds()))
    .orderBy(investmentOpeningOperationReceipts.actorUserId, investmentOpeningOperationReceipts.operationId);
}
async function deletionReceipts() {
  return (await pool.query("select * from investment_holding_deletion_receipts where household_id=ANY($1::uuid[]) order by actor_user_id,holding_id", [hhIds()])).rows;
}
async function deleteShell(cookie = subjectCookie, custody = accountId) {
  const created = await request(app).post("/api/investments/holdings").set("Cookie", cookie).send({ operationId: randomUUID(), expectedCurrency: "ZMW",
    accountId: custody, securityId, quantity: "0", costBasis: "0", acquiredDate: "2031-01-20" }).expect(201);
  await request(app).delete(`/api/investments/holdings/${created.body.data.id}`).set("Cookie", cookie).expect(204); return created.body.data.id as string;
}
async function identity() {
  return {
    users: await db.select().from(users).where(inArray(users.id, userIds())).orderBy(users.id),
    grants: await db.select().from(householdMembers).where(inArray(householdMembers.householdId, hhIds())).orderBy(householdMembers.userId, householdMembers.householdId),
    sessions: (await pool.query('select sid,sess,expire from "session" where sess->>\'userId\'=ANY($1::text[]) order by sid', [userIds()])).rows,
    devices: await db.select().from(userSessions).where(inArray(userSessions.userId, userIds())).orderBy(userSessions.id),
  };
}
const erase = () => eraseAccount({ userId: subjectId, householdId, userEmail: subjectEmail, ipAddress: "127.0.0.1" });

describe("R13 opening retries follow the actual account-erasure transaction", () => {
  beforeAll(async () => { app = await getTestApp(); passwordHash = await hashPassword(password); }, 30_000);
  beforeEach(async () => {
    householdId = randomUUID(); historicalHouseholdId = randomUUID(); subjectId = randomUUID(); peerId = randomUUID(); historicalPeerId = randomUUID();
    accountId = randomUUID(); historicalAccountId = randomUUID(); securityId = randomUUID(); subjectEmail = `r13-erase-${subjectId}@example.invalid`;
    await db.insert(households).values([{ id: householdId, name: "Synthetic current erasure household", currency: "ZMW" }, { id: historicalHouseholdId, name: "Synthetic earlier household", currency: "ZMW" }]);
    await db.insert(users).values([
      { id: subjectId, email: subjectEmail, username: `erase-${subjectId}`, passwordHash, emailVerified: true },
      { id: peerId, email: `peer-${peerId}@example.invalid`, username: `peer-${peerId}`, passwordHash, emailVerified: true },
      { id: historicalPeerId, email: `peer-${historicalPeerId}@example.invalid`, username: `peer-${historicalPeerId}`, passwordHash, emailVerified: true },
    ]);
    await db.insert(householdMembers).values([{ householdId, userId: subjectId, role: "member" }, { householdId, userId: peerId, role: "owner" },
      { householdId: historicalHouseholdId, userId: historicalPeerId, role: "owner" }]);
    await db.insert(accounts).values([{ id: accountId, householdId, name: "Current shared custody", type: "investment", currency: "ZMW", balance: "0", isPrivate: false },
      { id: historicalAccountId, householdId: historicalHouseholdId, name: "Historical shared custody", type: "investment", currency: "ZMW", balance: "0", isPrivate: false }]);
    await db.insert(securities).values({ id: securityId, symbol: `SYN_ERASE_${securityId.slice(0, 8)}`, name: "Synthetic erasure opening", type: "stock", currency: "ZMW" });
    const login = await request(app).post("/api/auth/login").send({ email: subjectEmail, password }).expect(200);
    subjectCookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    const peer = await request(app).post("/api/auth/login").send({ email: `peer-${peerId}@example.invalid`, password }).expect(200);
    peerCookie = (peer.headers["set-cookie"] as unknown as string[]).join("; ");
  });
  afterEach(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.userId, userIds()));
    await db.delete(households).where(inArray(households.id, hhIds()));
    await db.delete(securities).where(eq(securities.id, securityId));
    await pool.query('delete from "session" where sess->>\'userId\'=ANY($1::text[]) or sess->>\'mfaPendingUserId\'=ANY($1::text[])', [userIds()]);
    await db.delete(users).where(inArray(users.id, userIds()));
  });
  it("rejects an ordinary receipt DELETE while its actor and household remain live", async () => {
    const key = randomUUID(); await opening(key).expect(201);
    const before = { identity: await identity(), receipts: await receipts(), financial: await financial() };
    expect(before.identity.users.find(row => row.id === subjectId)!.erasedAt).toBeNull();
    expect(await db.select({ id: households.id }).from(households).where(eq(households.id, householdId))).toHaveLength(1);
    await expect(pool.query("delete from investment_opening_operation_receipts where household_id=$1 and actor_user_id=$2 and operation_id=$3",
      [householdId, subjectId, key])).rejects.toMatchObject({ code: "23514" });
    expect({ identity: await identity(), receipts: await receipts(), financial: await financial() }).toEqual(before);
  });
  it("purges only the erased actor's actual retry records across historical households and retains shared financial evidence", async () => {
    // Establish a genuine earlier operation while this is the subject's only
    // membership, then leave it before creating in the current household.
    await db.delete(householdMembers).where(eq(householdMembers.userId, subjectId));
    await db.insert(householdMembers).values({ householdId: historicalHouseholdId, userId: subjectId, role: "member" });
    const historicalKey = randomUUID(); await opening(historicalKey, subjectCookie, historicalAccountId).expect(201);
    await deleteShell(subjectCookie, historicalAccountId);
    await db.delete(householdMembers).where(eq(householdMembers.userId, subjectId));
    await db.insert(householdMembers).values({ householdId, userId: subjectId, role: "member" });
    const key = randomUUID(), peerKey = randomUUID(); await opening(key).expect(201); await opening(peerKey, peerCookie).expect(201);
    const subjectDeletedId = await deleteShell(), peerDeletedId = await deleteShell(peerCookie);
    const before = await financial(), peerReceipts = (await receipts()).filter(row => row.actorUserId === peerId);
    const peerDeletes = (await deletionReceipts()).filter(row => row.actor_user_id === peerId);
    expect((await receipts()).filter(row => row.actorUserId === subjectId)).toHaveLength(4); expect(peerReceipts).toHaveLength(2);
    expect((await deletionReceipts()).filter(row => row.actor_user_id === subjectId)).toHaveLength(2); expect(peerDeletes).toHaveLength(1);
    expect(await erase()).toEqual({ householdDeleted: false });
    expect(await receipts()).toEqual(peerReceipts);
    expect(await deletionReceipts()).toEqual(peerDeletes);
    const after = await financial(); expect({ ...after, audits: undefined }).toEqual({ ...before, audits: undefined });
    expect(after.audits.filter(row => row.entityType !== "user_account")).toEqual(before.audits);
    const [subject] = await db.select().from(users).where(eq(users.id, subjectId));
    expect(subject.erasedAt).not.toBeNull(); expect(subject.passwordHash).toMatch(/^!erased!/);
    await opening(key).expect(401); expect((await opening(peerKey, peerCookie).expect(201)).body.data.id)
      .toBe(peerReceipts.find(row => row.operationId === peerKey)!.holdingId);
    await request(app).delete(`/api/investments/holdings/${subjectDeletedId}`).set("Cookie", subjectCookie).expect(401);
    await request(app).delete(`/api/investments/holdings/${peerDeletedId}`).set("Cookie", peerCookie).expect(204);
    expect(await deletionReceipts()).toEqual(peerDeletes);
  });

  it("permits the physical last-household cascade while retaining only the anonymized identity", async () => {
    await db.delete(householdMembers).where(eq(householdMembers.userId, peerId));
    const key = randomUUID(); await opening(key).expect(201); await deleteShell(); expect(await receipts()).toHaveLength(2); expect(await deletionReceipts()).toHaveLength(1);
    expect(await erase()).toEqual({ householdDeleted: true });
    expect(await receipts()).toEqual([]); expect(await db.select().from(households).where(eq(households.id, householdId))).toEqual([]);
    expect(await deletionReceipts()).toEqual([]);
    expect(await db.select().from(holdings).where(eq(holdings.householdId, householdId))).toEqual([]);
    expect(await db.select().from(investmentTransactions).where(eq(investmentTransactions.householdId, householdId))).toEqual([]);
    const [subject] = await db.select().from(users).where(eq(users.id, subjectId)); expect(subject.erasedAt).not.toBeNull();
    await opening(key).expect(401);
  });

  it("retains positive-origin deletion protection after actual erasure purges the creator receipt but keeps its actor tombstone", async () => {
    const key = randomUUID(), created = await opening(key).expect(201), holdingId = created.body.data.id;
    // Explicit corruption removes current trade/lot evidence and zeros the
    // aggregate. The genuine original CREATE audit remains authoritative.
    await db.delete(taxLots).where(eq(taxLots.holdingId, holdingId));
    await db.delete(investmentTransactions).where(eq(investmentTransactions.holdingId, holdingId));
    await db.update(holdings).set({ quantity: "0", costBasis: "0", costBasisZmw: "0" }).where(eq(holdings.id, holdingId));
    await db.delete(auditLogs).where(and(eq(auditLogs.entityType, "investment_transaction"), sql`${auditLogs.details}->'newValue'->>'holdingId'=${holdingId}`));
    expect(await erase()).toEqual({ householdDeleted: false }); expect(await receipts()).toEqual([]);
    const [subject] = await db.select().from(users).where(eq(users.id, subjectId)); expect(subject.erasedAt).not.toBeNull();
    const before = await financial();
    expect(before.audits.filter(row => row.entityId === holdingId && row.action === "CREATE"))
      .toEqual([expect.objectContaining({ userId: subjectId, householdId: null })]);
    const response = await request(app).delete(`/api/investments/holdings/${holdingId}`).set("Cookie", peerCookie).expect(409);
    expect(response.body).not.toHaveProperty("data"); expect(await financial()).toEqual(before);
  });

  it("retains a nonreuse witness for another actor after actual erasure removes the deletion receipt", async () => {
    const holdingId = await deleteShell(); expect(await erase()).toEqual({ householdDeleted: false }); expect(await deletionReceipts()).toEqual([]);
    await db.insert(holdings).values({ id: holdingId, householdId, accountId, securityId, quantity: "0", costBasis: "0", costBasisZmw: "0", acquiredDate: "2031-01-20" });
    const before = await financial();
    await request(app).delete(`/api/investments/holdings/${holdingId}`).set("Cookie", peerCookie).expect(409);
    expect(await financial()).toEqual(before); expect(await deletionReceipts()).toEqual([]);
  });

  it.each(["investment_opening_operation_receipts", "investment_holding_deletion_receipts"])("rolls back identity, both receipt families and finance if actual %s purge fails", async table => {
    const key = randomUUID(), peerKey = randomUUID(); await opening(key).expect(201); await opening(peerKey, peerCookie).expect(201);
    await deleteShell(); await deleteShell(peerCookie);
    const before = { identity: await identity(), receipts: await receipts(), deletions: await deletionReceipts(), financial: await financial() };
    const fault = `r13_actor_purge_fault_${randomUUID().replace(/-/g, "")}`;
    try {
      await pool.query(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN RAISE EXCEPTION 'Synthetic opening actor purge failure' USING ERRCODE='23514'; END $body$`);
      await pool.query(`CREATE TRIGGER "${fault}" BEFORE DELETE ON public.${table} FOR EACH ROW
        WHEN (OLD.actor_user_id='${subjectId}'::uuid) EXECUTE FUNCTION public."${fault}"()`);
      await expect(erase()).rejects.toBeDefined();
      expect({ identity: await identity(), receipts: await receipts(), deletions: await deletionReceipts(), financial: await financial() }).toEqual(before);
      await opening(key).expect(201);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${fault}" ON public.${table}`);
      await pool.query(`DROP FUNCTION IF EXISTS public."${fault}"()`);
    }
    expect(await erase()).toEqual({ householdDeleted: false });
    expect((await receipts()).map(row => row.actorUserId)).toEqual([peerId, peerId]);
    expect((await deletionReceipts()).map(row => row.actor_user_id)).toEqual([peerId]); await opening(key).expect(401);
  });
});
