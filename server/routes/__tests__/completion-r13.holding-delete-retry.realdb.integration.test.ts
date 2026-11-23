import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, holdings, securities } from "@shared/schema";
import { db, pool } from "../../db";
import * as sourceAccess from "../../modules/investments/investmentTransactionAccess";
import { a, b, actors, app, ids, reset, start, stop } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const securityId = randomUUID(), reboundSecurityId = randomUUID();
const remove = (id: string) => request(app).delete(`/api/investments/holdings/${id}`).set("Cookie", actors.get("member")!.cookie);
const digest = (id: string, actor = actors.get("member")!.id) => createHash("sha256").update(JSON.stringify({ version: 1,
  householdId: a, actorUserId: actor, verb: "DELETE", holdingId: id.toLowerCase() })).digest("hex");
async function shell(extra: Partial<typeof holdings.$inferInsert> = {}) {
  const [row] = await db.insert(holdings).values({ householdId: a, accountId: ids.sharedAccount, securityId,
    quantity: "0", costBasis: "0", costBasisZmw: "0", acquiredDate: "2031-01-20", ...extra }).returning(); return row;
}
async function clean() {
  await db.delete(holdings).where(inArray(holdings.householdId, [a, b]));
  await db.delete(securities).where(inArray(securities.id, [securityId, reboundSecurityId]));
}
async function receipts() {
  return (await pool.query("select * from investment_holding_deletion_receipts where household_id=$1 order by holding_id", [a])).rows;
}
async function effects() {
  return { holdings: await db.select().from(holdings).where(inArray(holdings.householdId, [a, b])).orderBy(holdings.id),
    accounts: await db.select().from(accounts).where(inArray(accounts.householdId, [a, b])).orderBy(accounts.id),
    audits: await db.select().from(auditLogs).where(inArray(auditLogs.userId, Array.from(actors.values()).map(row => row.id))).orderBy(auditLogs.id),
    receipts: await receipts() };
}
async function committed() {
  const row = await shell(); await remove(row.id).expect(204);
  const proof = (await receipts()).find(item => item.holding_id === row.id); expect(proof).toBeDefined();
  const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.id, proof.delete_audit_id)); expect(audit).toBeDefined();
  return { row, proof, audit };
}

describe("R13 deletion acknowledgements bind one immutable physical effect to a genuine actor-only audit", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => { await clean(); await reset(); await db.insert(securities).values({ id: securityId,
    symbol: "SYN_DEL_RETRY", name: "Synthetic deletion evidence", type: "stock", currency: "ZMW" }); });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it("commits one versioned request/effect receipt and replays without another receipt or audit", async () => {
    const { row, proof, audit } = await committed();
    expect(proof).toMatchObject({ household_id: a, actor_user_id: actors.get("member")!.id, holding_id: row.id,
      account_id: ids.sharedAccount, security_id: securityId, request_version: 1, request_digest: digest(row.id),
      effect_digest: expect.stringMatching(/^[0-9a-f]{64}$/), delete_audit_id: audit.id, created_at: expect.any(Date) });
    expect(audit).toMatchObject({ householdId: null, userId: actors.get("member")!.id, action: "DELETE", entityType: "holding", entityId: row.id });
    const before = await effects(); await remove(row.id).expect(204); expect(await effects()).toEqual(before);
  });
  it.each(["UPDATE", "DELETE"])("forbids ordinary active-actor receipt %s with both parents live", async operation => {
    const { row } = await committed(), before = await effects();
    const statement = operation === "UPDATE" ? "update investment_holding_deletion_receipts set effect_digest=repeat('0',64)" : "delete from investment_holding_deletion_receipts";
    await expect(pool.query(`${statement} where household_id=$1 and holding_id=$2`, [a, row.id])).rejects.toMatchObject({ code: "23514" });
    expect(await effects()).toEqual(before);
  });
  it.each(["native null", "base null", "generation", "extra financial field", "audience", "actor", "entity", "action"])("refuses mutable audit %s damage against the immutable effect digest", async damage => {
    const { row, audit } = await committed(), details = structuredClone(audit.details) as { oldValue: Record<string, unknown> };
    if (damage === "native null") details.oldValue.costBasis = null;
    if (damage === "base null") details.oldValue.costBasisZmw = null;
    if (damage === "generation") details.oldValue.createdAt = "2030-01-01T00:00:00.000Z";
    if (damage === "extra financial field") details.oldValue.amount = "0.00";
    await db.update(auditLogs).set({ details, ...(damage === "audience" ? { householdId: a } : {}),
      ...(damage === "actor" ? { userId: actors.get("admin")!.id } : {}), ...(damage === "entity" ? { entityId: randomUUID() } : {}),
      ...(damage === "action" ? { action: "CREATE" } : {}) }).where(eq(auditLogs.id, audit.id));
    const before = await effects(), response = await remove(row.id).expect(409);
    expect(response.body).not.toHaveProperty("data"); expect(await effects()).toEqual(before);
  });
  it("reauthorizes original custody before exposing an audit-witness conflict", async () => {
    const { row, audit } = await committed(); await db.update(auditLogs).set({ details: {} }).where(eq(auditLogs.id, audit.id));
    await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id }).where(eq(accounts.id, ids.sharedAccount));
    const before = await effects(), response = await remove(row.id).expect(404);
    expect(response.body).toEqual({ success: false, error: { code: "NOT_FOUND", message: "Holding not found", timestamp: expect.any(String) } });
    expect(await effects()).toEqual(before);
  });
  it("enforces one physical household/holding deletion across actors and one receipt per audit UUID", async () => {
    const { row, proof } = await committed(), before = await effects();
    for (const [holdingId, auditId] of [[row.id, randomUUID()], [randomUUID(), proof.delete_audit_id]]) await expect(pool.query(`insert into investment_holding_deletion_receipts
      (household_id,actor_user_id,holding_id,account_id,security_id,request_version,request_digest,effect_digest,delete_audit_id)
      values($1,$2,$3,$4,$5,1,$6,$7,$8)`, [a, actors.get("admin")!.id, holdingId, ids.sharedAccount, securityId,
      digest(holdingId, actors.get("admin")!.id), proof.effect_digest, auditId])).rejects.toMatchObject({ code: "23505" });
    expect(await effects()).toEqual(before);
  });
  it("rejects a deliberate forged INSERT pointing at a genuine CREATE rather than a deletion audit", async () => {
    const genuine = await committed(), damaged = await shell(), auditId = randomUUID();
    await db.delete(holdings).where(eq(holdings.id, damaged.id));
    await db.insert(auditLogs).values({ id: auditId, userId: actors.get("member")!.id, householdId: null,
      entityType: "holding", entityId: damaged.id, action: "CREATE", details: genuine.audit.details });
    await pool.query(`insert into investment_holding_deletion_receipts
      (household_id,actor_user_id,holding_id,account_id,security_id,request_version,request_digest,effect_digest,delete_audit_id)
      values($1,$2,$3,$4,$5,1,$6,$7,$8)`, [a, actors.get("member")!.id, damaged.id, ids.sharedAccount, securityId,
      digest(damaged.id), genuine.proof.effect_digest, auditId]);
    const before = await effects(); await remove(damaged.id).expect(409); expect(await effects()).toEqual(before);
  });
  it.each(["private custody", "foreign household"])("hides a resurrected UUID rebound to %s before receipt status", async rebound => {
    const { row } = await committed();
    await shell({ id: row.id, householdId: rebound === "foreign household" ? b : a,
      accountId: rebound === "foreign household" ? ids.foreignAccount : ids.privateAccount });
    const before = await effects(), response = await remove(row.id).expect(404);
    expect(response.body).toEqual({ success: false, error: { code: "NOT_FOUND", message: "Holding not found", timestamp: expect.any(String) } });
    expect(await effects()).toEqual(before);
  });
  it.each(["withdrawn original custody", "different visible custody", "different visible security"])("reauthorizes ORIGINAL custody before deciding a resurrected UUID with %s", async rebound => {
    const { row } = await committed(), nextAccountId = randomUUID();
    await db.insert(accounts).values({ id: nextAccountId, householdId: a, name: "Synthetic visible rebound custody", type: "investment",
      currency: "ZMW", balance: "0", isPrivate: false, ownerUserId: actors.get("owner")!.id });
    if (rebound === "withdrawn original custody") await db.update(accounts).set({ isPrivate: true, ownerUserId: actors.get("owner")!.id })
      .where(eq(accounts.id, ids.sharedAccount));
    if (rebound === "different visible security") await db.insert(securities).values({ id: reboundSecurityId,
      symbol: "SYN_DEL_REBOUND", name: "Synthetic visible instrument rebound", type: "stock", currency: "ZMW" });
    await shell({ id: row.id, accountId: rebound === "different visible security" ? ids.sharedAccount : nextAccountId,
      securityId: rebound === "different visible security" ? reboundSecurityId : securityId });
    const gate = vi.spyOn(sourceAccess, "lockInvestmentTransactionSources"), before = await effects();
    const response = await remove(row.id).expect(404);
    expect(gate).toHaveBeenCalled();
    expect(gate.mock.calls[0][2]).toEqual({ accountId: ids.sharedAccount, securityId });
    expect(response.body).toEqual({ success: false, error: { code: "NOT_FOUND", message: "Holding not found", timestamp: expect.any(String) } });
    expect(await effects()).toEqual(before);
  });
  it("rolls back receipt-insert failure and admits one exact retry after the fault is removed", async () => {
    const row = await shell(), before = await effects(), fault = `r13_del_receipt_fault_${randomUUID().replace(/-/g, "")}`;
    try {
      await pool.query(`CREATE FUNCTION public."${fault}"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $body$
        BEGIN RAISE EXCEPTION 'Synthetic deletion receipt failure' USING ERRCODE='23514'; END $body$`);
      await pool.query(`CREATE TRIGGER "${fault}" BEFORE INSERT ON public.investment_holding_deletion_receipts FOR EACH ROW
        WHEN (NEW.holding_id='${row.id}'::uuid) EXECUTE FUNCTION public."${fault}"()`);
      const response = await remove(row.id).expect(500); expect(response.text).not.toContain("Synthetic deletion receipt failure"); expect(await effects()).toEqual(before);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${fault}" ON public.investment_holding_deletion_receipts`); await pool.query(`DROP FUNCTION IF EXISTS public."${fault}"()`);
    }
    await remove(row.id).expect(204); const committedState = await effects(); await remove(row.id).expect(204); expect(await effects()).toEqual(committedState);
    expect(committedState.receipts.filter(item => item.holding_id === row.id)).toHaveLength(1);
  });
});
