import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, grzBonds, householdMembers, households, users } from "@shared/schema";
import { grzBondValuations } from "@shared/grz-bond-valuation-schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";

// Test-local SQL role, created only by the coordinator's protected disposable
// owner. Its grants permit ordinary writes, never table ownership or DDL.
const writerRole = `r13_value_writer_${randomUUID().replace(/-/g, "")}`;
const password = "SyntheticStorageEvidence123!", isin = "ZM0000000001";
let app: Awaited<ReturnType<typeof getTestApp>>, passwordHash: string, roleCreated = false;
let householdId: string, recorderId: string, recorderEmail: string, bondId: string, accountId: string, cookie: string, date: string;
let fixtureUsers: string[] = [];
type Command = { text: string; values?: unknown[] };

/** role null = a user with no membership. One owner per household (NEW-12), so extra members are admins. */
async function addUser(role: "owner" | "admin" | null = "owner") {
  const id = randomUUID(), email = `r13-store-${id}@example.invalid`; fixtureUsers.push(id);
  await db.insert(users).values({ id, email, username: `r13-store-${id}`, passwordHash, emailVerified: true });
  if (role) await db.insert(householdMembers).values({ householdId, userId: id, role });
  return { id, email };
}
async function login(email: string) {
  const response = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
  return (response.headers["set-cookie"] as unknown as string[]).join("; ");
}
function record(amount = "970.00") {
  return request(app).post(`/api/grz/bonds/${bondId}/valuations`).set("Cookie", cookie).send({ operationId: randomUUID(),
    valuationDate: date, sourceDate: date, nominalAmount: "1000.00", isin, currency: "ZMW", sourceKind: "custodian_statement",
    sourceReference: "Synthetic storage-proof statement", quoteBasis: "clean", quoteUnits: "holding_amount", quotedAmount: amount, accruedInterest: "25.10" });
}
async function stored() {
  return (await pool.query("select to_jsonb(v) as data from grz_bond_valuations v where household_id=$1 order by sequence", [householdId])).rows;
}
async function latestId() {
  return (await pool.query<{ id: string }>("select id::text from grz_bond_valuations where household_id=$1 order by sequence desc limit 1", [householdId])).rows[0].id;
}
async function restricted(commands: Command[], rollbackOnly = false) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query(`SET LOCAL ROLE "${writerRole}"`);
    const proof = await client.query<{ actor: string; superuser: boolean; owns: boolean }>(`select current_user as actor,r.rolsuper as superuser,
      pg_has_role(current_user,c.relowner,'MEMBER') as owns from pg_roles r cross join pg_class c
      where r.rolname=current_user and c.oid='public.grz_bond_valuations'::regclass`);
    expect(proof.rows).toEqual([{ actor: writerRole, superuser: false, owns: false }]);
    for (const command of commands) await client.query(command.text, command.values);
    // Flush the same deferred check COMMIT would run, then always roll back
    // whole-table probes even on the vulnerable baseline.
    if (rollbackOnly) { await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await client.query("ROLLBACK"); }
    else await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function clean() {
  if (!householdId) return;
  const members = await db.select({ id: householdMembers.userId }).from(householdMembers).where(eq(householdMembers.householdId, householdId));
  // Use the real erasure transaction, including its existing anonymisation.
  // The final member removes the actual household before deferred checks run.
  for (const member of members) if (member.id) {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, member.id));
    if (user) await eraseAccount({ userId: member.id, userEmail: user.email, householdId });
  }
  await db.delete(auditLogs).where(inArray(auditLogs.userId, fixtureUsers));
  for (const id of fixtureUsers) await pool.query('delete from "session" where sess->>\'userId\'=$1', [id]);
  if (fixtureUsers.length) await db.delete(users).where(inArray(users.id, fixtureUsers));
  fixtureUsers = [];
}

describe("R13 valuation evidence remains immutable for a restricted SQL writer", () => {
  beforeAll(async () => {
    app = await getTestApp(); passwordHash = await hashPassword(password);
    await pool.query(`CREATE ROLE "${writerRole}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`); roleCreated = true;
    await pool.query(`GRANT "${writerRole}" TO CURRENT_USER`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${writerRole}"`);
    await pool.query(`GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.grz_bond_valuations TO "${writerRole}"`);
    await pool.query(`GRANT SELECT ON public.households TO "${writerRole}"`);
    await pool.query(`GRANT SELECT,DELETE ON public.users,public.household_members TO "${writerRole}"`);
    await pool.query(`GRANT TRUNCATE ON public.grz_principal_settlements TO "${writerRole}"`);
  }, 30_000);
  beforeEach(async () => {
    householdId = randomUUID(); bondId = randomUUID(); accountId = randomUUID(); fixtureUsers = [];
    await db.insert(households).values({ id: householdId, name: "Synthetic immutable valuation", currency: "ZMW" });
    const recorder = await addUser(); recorderId = recorder.id; recorderEmail = recorder.email; cookie = await login(recorder.email);
    date = (await pool.query<{ date: string }>("select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date")).rows[0].date;
    await db.insert(accounts).values({ id: accountId, householdId, name: "Synthetic custody", type: "investment", currency: "ZMW", balance: "0.00", isAsset: true });
    await db.insert(grzBonds).values({ id: bondId, householdId, accountId, isin, bondName: "Synthetic stored mark", tenorYears: 5,
      faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.20", purchaseDate: "2025-01-01", maturityDate: "2030-01-01" });
    await record("960.00").expect(201); await record().expect(201);
  });
  afterEach(clean);
  afterAll(async () => {
    await clean();
    if (roleCreated) { await pool.query(`DROP OWNED BY "${writerRole}"`); await pool.query(`DROP ROLE "${writerRole}"`); }
  });

  it("rejects a coherent quote/component reprice instead of publishing a different value under an old source id", async () => {
    const before = await stored(), id = await latestId();
    await expect(restricted([{ text: `update public.grz_bond_valuations set quoted_amount='980.00',clean_value='980.00',dirty_value='1005.10',
      source_reference='Repriced old source',intent_hash=repeat('b',64) where id=$1`, values: [id] }])).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
    expect((await request(app).get("/api/accounts/summary").set("Cookie", cookie).expect(200)).body.data.netWorth).toBe(995.1);
    await record("980.00").expect(201); expect(await stored()).toHaveLength(3);
  });
  it("rejects deleting the latest mark and falling back to an older observation", async () => {
    const before = await stored();
    await expect(restricted([{ text: "delete from public.grz_bond_valuations where id=$1", values: [await latestId()] }])).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
  });
  it("rejects a forged erasure flag and removed memberships while the original household remains", async () => {
    const before = await stored();
    await expect(restricted([
      { text: "select set_config('app.erasing_household',$1,true)", values: [householdId] },
      { text: "delete from public.household_members where household_id=$1", values: [householdId] },
      { text: "delete from public.grz_bond_valuations where household_id=$1", values: [householdId] },
    ], true)).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
  });
  it("blocks the actual recorder FK SET NULL action instead of permitting a cascading evidence update", async () => {
    const unreferenced = await addUser(null);
    const [original] = await db.select().from(grzBondValuations).where(eq(grzBondValuations.householdId, householdId));
    // Storage-only FK fixture. Signed recorder erasure is separately exercised
    // below; this user has no other FK that could mask the quote trigger.
    await db.insert(grzBondValuations).values({ ...original, id: randomUUID(), sequence: undefined, operationId: randomUUID(), recordedBy: unreferenced.id });
    const before = await stored();
    await expect(restricted([{ text: "delete from public.users where id=$1", values: [unreferenced.id] }])).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
  });
  it("rejects TRUNCATE CASCADE before any whole-table evidence disappears", async () => {
    const before = await stored();
    await expect(restricted([{ text: "truncate public.grz_bond_valuations cascade" }], true)).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
  });
  it("runs probes without table-owner authority to disable triggers", async () => {
    await expect(restricted([{ text: "alter table public.grz_bond_valuations disable trigger all" }], true)).rejects.toMatchObject({ code: "42501" });
  });
  it("allows the existing true last-member household erasure to commit", async () => {
    expect(await eraseAccount({ userId: recorderId, userEmail: recorderEmail, householdId })).toEqual({ householdDeleted: true });
    expect(await stored()).toEqual([]); expect(await db.select().from(households).where(eq(households.id, householdId))).toEqual([]);
    const [user] = await db.select().from(users).where(eq(users.id, recorderId));
    expect(user.erasedAt).not.toBeNull(); expect(user.email).toContain("@deleted.invalid");
  });
  it("preserves the exact source when the real recorder erases their identity from a retained household", async () => {
    const remaining = await addUser("admin"), remainingCookie = await login(remaining.email), before = await stored();
    expect(await eraseAccount({ userId: recorderId, userEmail: recorderEmail, householdId })).toEqual({ householdDeleted: false });
    expect(await stored()).toEqual(before);
    const [user] = await db.select().from(users).where(eq(users.id, recorderId)); expect(user.erasedAt).not.toBeNull(); expect(user.email).toContain("@deleted.invalid");
    expect((await request(app).get("/api/accounts/summary").set("Cookie", remainingCookie).expect(200)).body.data.netWorth).toBe(995.1);
    const remainingMembership = await db.select().from(householdMembers).where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, remaining.id)));
    expect(remainingMembership).toHaveLength(1);
    expect(remainingMembership[0].role).toBe("owner");
  });
});
