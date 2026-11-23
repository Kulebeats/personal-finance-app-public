import { randomUUID } from "node:crypto";
import request from "supertest";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, grzBonds, householdMembers, households, users } from "@shared/schema";
import { householdCalendarDate, shiftCalendarDate } from "@shared/household-calendar";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";
import { eraseAccount } from "../../modules/settings/settings.account-deletion.service";
import { readLockedGrzPrincipalBasis } from "../../services/grz/principalBasis";
import { lockGrzWriter } from "../../services/grz/couponPaymentAccess";

const writerRole = `r13_basis_writer_${randomUUID().replace(/-/g, "")}`;
const password = "SyntheticBasisRetention123!", isin = "ZM0000000001";
let app: Awaited<ReturnType<typeof getTestApp>>, passwordHash: string, roleCreated = false;
let householdId: string, userId: string, email: string, accountId: string, bondId: string, cookie: string, date: string, operationId: string;
let fixtureUsers: string[] = [];
type Command = { text: string; values?: unknown[] };
async function restricted(commands: Command[], rollbackOnly = false, ready?: (pid: number) => void) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query(`SET LOCAL ROLE "${writerRole}"`);
    const proof = await client.query<{ actor: string; superuser: boolean; owns: boolean }>(`select current_user as actor,r.rolsuper as superuser,
      pg_has_role(current_user,c.relowner,'MEMBER') as owns from pg_roles r cross join pg_class c
      where r.rolname=current_user and c.oid='public.grz_bond_principal_basis'::regclass`);
    expect(proof.rows).toEqual([{ actor: writerRole, superuser: false, owns: false }]);
    if (ready) ready((await client.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid);
    for (const command of commands) await client.query(command.text, command.values);
    if (rollbackOnly) { await client.query("SET CONSTRAINTS ALL IMMEDIATE"); await client.query("ROLLBACK"); }
    else await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
function record(overrides: Record<string, unknown> = {}, holdingId = bondId) {
  return request(app).post(`/api/grz/bonds/${holdingId}/principal-basis`).set("Cookie", cookie)
    .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({ operationId,
      acquisitionDate: "2025-06-30", sourceDate: date, isin, currency: "ZMW", purchaseCashAmount: "950.00",
      principalCost: "950.00", purchasedInterest: "0.00", acquisitionFees: "0.00", sourceKind: "custodian_statement",
      sourceReference: "Synthetic source acquisition statement", ...overrides });
}
async function stored() {
  return (await pool.query("select to_jsonb(b) as data from grz_bond_principal_basis b where household_id=$1 order by sequence", [householdId])).rows;
}
async function latestId() {
  return (await pool.query<{ id: string }>("select id::text from grz_bond_principal_basis where household_id=$1 order by sequence desc limit 1", [householdId])).rows[0].id;
}
function copiedInsert(reference: string | null, recorder: string | null): Command {
  return { text: `insert into public.grz_bond_principal_basis
    (household_id,bond_id,account_id,recorded_by,operation_id,intent_hash,authority,isin,nominal_amount,currency,acquisition_date,source_date,
      source_kind,source_reference,purchase_cash_amount,principal_cost,purchased_interest,acquisition_fees,policy_version)
    select household_id,bond_id,account_id,$2::uuid,$3::uuid,intent_hash,authority,isin,nominal_amount,currency,acquisition_date,source_date,
      source_kind,$4,purchase_cash_amount,principal_cost,purchased_interest,acquisition_fees,policy_version
    from public.grz_bond_principal_basis where id=$1::uuid`, values: [null, recorder, randomUUID(), reference] };
}
async function clean() {
  if (!householdId) return;
  const members = await db.select({ id: householdMembers.userId }).from(householdMembers).where(eq(householdMembers.householdId, householdId));
  for (const member of members) if (member.id) {
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, member.id));
    if (user) await eraseAccount({ userId: member.id, userEmail: user.email, householdId });
  }
  if (fixtureUsers.length) await db.delete(auditLogs).where(inArray(auditLogs.userId, fixtureUsers));
  for (const id of fixtureUsers) await pool.query('delete from "session" where sess->>\'userId\'=$1', [id]);
  if (fixtureUsers.length) await db.delete(users).where(inArray(users.id, fixtureUsers));
  fixtureUsers = [];
}

describe("R13 principal basis history survives a restricted SQL writer until whole-household erasure", () => {
  beforeAll(async () => {
    app = await getTestApp(); passwordHash = await hashPassword(password);
    await pool.query(`CREATE ROLE "${writerRole}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`); roleCreated = true;
    await pool.query(`GRANT "${writerRole}" TO CURRENT_USER`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${writerRole}"`);
    await pool.query(`GRANT SELECT,INSERT,UPDATE,DELETE,TRUNCATE ON public.grz_bond_principal_basis TO "${writerRole}"`);
    await pool.query(`GRANT USAGE,SELECT ON SEQUENCE public.grz_bond_principal_basis_sequence_seq TO "${writerRole}"`);
    await pool.query(`GRANT SELECT ON public.households TO "${writerRole}"`);
    await pool.query(`GRANT TRUNCATE ON public.grz_principal_settlements TO "${writerRole}"`);
  }, 30_000);
  beforeEach(async () => {
    householdId = randomUUID(); userId = randomUUID(); accountId = randomUUID(); bondId = randomUUID(); operationId = randomUUID();
    fixtureUsers = [userId]; email = `r13-basis-storage-${userId}@example.invalid`;
    date = (await pool.query<{ date: string }>("select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date")).rows[0].date;
    await db.insert(households).values({ id: householdId, name: "Synthetic principal basis retention", currency: "ZMW" });
    await db.insert(users).values({ id: userId, email, username: `r13-basis-storage-${userId}`, passwordHash, emailVerified: true });
    await db.insert(householdMembers).values({ householdId, userId, role: "owner" });
    await db.insert(accounts).values({ id: accountId, householdId, name: "Synthetic acquisition custody", type: "investment", currency: "ZMW", isAsset: true });
    await db.insert(grzBonds).values({ id: bondId, householdId, accountId, isin, bondName: "Synthetic basis retention", tenorYears: 5,
      faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0000", purchaseDate: "2025-06-30", maturityDate: "2030-06-30" });
    const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
    await record().expect(201);
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => {
    await clean();
    if (roleCreated) { await pool.query(`DROP OWNED BY "${writerRole}"`); await pool.query(`DROP ROLE "${writerRole}"`); }
  });

  it("rejects deletion of an old unconsumed basis instead of allowing its operation to acquire different economics", async () => {
    const before = await stored(), id = await latestId();
    await expect(restricted([{ text: "delete from public.grz_bond_principal_basis where id=$1", values: [id] }])).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
    await record({ principalCost: "900.00", purchasedInterest: "50.00" }).expect(409);
    expect(await stored()).toEqual(before);
  });
  it("rejects TRUNCATE CASCADE before historical acquisition facts disappear", async () => {
    const before = await stored();
    await expect(restricted([{ text: "truncate public.grz_bond_principal_basis cascade" }], true)).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
  });
  it.each(["blank reference", "missing recorder"])("rejects %s in a new restricted-writer acquisition record", async kind => {
    const before = await stored(), command = copiedInsert(kind === "blank reference" ? " \t " : "Synthetic copied statement", kind === "missing recorder" ? null : userId);
    command.values![0] = await latestId();
    await expect(restricted([command], true)).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
  });
  it("proves restricted writes have ordinary INSERT access without table-owner authority to disable guards", async () => {
    const command = copiedInsert("Synthetic valid copied statement", userId); command.values![0] = await latestId();
    await restricted([command], true);
    await expect(restricted([{ text: "alter table public.grz_bond_principal_basis disable trigger all" }], true)).rejects.toMatchObject({ code: "42501" });
  });
  it("retains attributable history after recorder erasure while a co-member survives", async () => {
    const successor = randomUUID(); fixtureUsers.push(successor);
    await db.insert(users).values({ id: successor, email: `r13-basis-successor-${successor}@example.invalid`, username: `r13-basis-successor-${successor}`, passwordHash, emailVerified: true });
    // One owner per household (NEW-12): the co-member joins as admin and erasure promotes them.
    await db.insert(householdMembers).values({ householdId, userId: successor, role: "admin" });
    const before = await stored(), id = await latestId();
    await eraseAccount({ userId, userEmail: email, householdId });
    const [promoted] = await db.select().from(householdMembers).where(eq(householdMembers.userId, successor)); expect(promoted.role).toBe("owner");
    const [subject] = await db.select().from(users).where(eq(users.id, userId)); expect(subject.erasedAt).not.toBeNull();
    expect(await stored()).toEqual(before);
    const evidence = await db.transaction(async tx => {
      const actor = await lockGrzWriter(tx, { householdId, userId: successor, role: "owner" });
      await tx.select().from(grzBonds).where(eq(grzBonds.id, bondId)).for("update");
      await tx.select().from(accounts).where(eq(accounts.id, accountId)).for("update");
      return readLockedGrzPrincipalBasis(tx, actor, bondId);
    });
    expect(evidence?.sourceId).toBe(id); expect(evidence?.costBasis.toString()).toBe("950.00");
    const command = copiedInsert("Synthetic new statement cannot use an erased recorder", userId); command.values![0] = id;
    await expect(restricted([command], true)).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
  });

  it.each(["bond retired", "custody becomes non-asset", "custody becomes private"])(
    "rejects a late restricted basis insertion after an earlier %s withdrawal commits", async change => {
      const before = await stored(), command = copiedInsert("Synthetic late acquisition statement", userId);
      command.values![0] = await latestId();
      let other: string | undefined;
      if (change === "custody becomes private") {
        other = randomUUID(); fixtureUsers.push(other);
        await db.insert(users).values({ id: other, email: `r13-basis-other-${other}@example.invalid`, username: `r13-basis-other-${other}`,
          passwordHash, emailVerified: true });
        await db.insert(householdMembers).values({ householdId, userId: other, role: "member" });
      }
      const earlier = await pool.connect();
      let completed = false, insertion: Promise<{ code: string | undefined }> | undefined;
      try {
        await earlier.query("BEGIN");
        const earlierPid = (await earlier.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
        if (change === "bond retired") await earlier.query("update grz_bonds set status='sold' where id=$1", [bondId]);
        else if (change === "custody becomes non-asset") await earlier.query("update accounts set is_asset=false where id=$1", [accountId]);
        else await earlier.query("update accounts set is_private=true,owner_user_id=$2 where id=$1", [accountId, other]);
        let announce!: (pid: number) => void;
        const started = new Promise<number>(resolve => { announce = resolve; });
        insertion = restricted([command], true, announce).then(() => ({ code: undefined }), error => ({ code: (error as { code?: string }).code }))
          .then(value => { completed = true; return value; });
        const latePid = await started;
        let observedBlocked = false;
        for (let i = 0; i < 100 && !completed; i++) {
          const blockers = await pool.query<{ pids: number[] }>("select pg_blocking_pids($1) as pids", [latePid]);
          if (blockers.rows[0].pids.includes(earlierPid)) { observedBlocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        // Pre-fix the unlocked predicate admits the old row immediately. The
        // guarded implementation waits, then must recheck the committed row.
        expect(completed || observedBlocked).toBe(true);
        await earlier.query("COMMIT");
        expect(await insertion).toEqual({ code: "23514" });
        expect(await stored()).toEqual(before);
      } finally {
        await earlier.query("ROLLBACK"); earlier.release();
        await insertion;
      }
    }, 15_000);

  it("normalises route and operation UUID case before hashing and replay comparisons", async () => {
    const key = randomUUID();
    const first = await record({ operationId: key.toUpperCase() }, bondId.toUpperCase()).expect(201);
    const second = await record({ operationId: key }, bondId).expect(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it.each([false, true])("rejects non-asset custody for writer and replay (replay=%s)", async replay => {
    await db.update(accounts).set({ isAsset: false }).where(eq(accounts.id, accountId));
    const before = await stored();
    await record({ operationId: replay ? operationId : randomUUID() }).expect(409);
    expect(await stored()).toEqual(before);
  });

  it("withholds historical principal basis when its custody is no longer a ZMW asset account", async () => {
    await db.update(accounts).set({ isAsset: false }).where(eq(accounts.id, accountId));
    const evidence = await db.transaction(async tx => {
      await tx.select().from(households).where(eq(households.id, householdId)).for("share");
      const actor = await lockGrzWriter(tx, { householdId, userId, role: "owner" });
      await tx.select().from(grzBonds).where(eq(grzBonds.id, bondId)).for("update");
      await tx.select().from(accounts).where(eq(accounts.id, accountId)).for("update");
      return readLockedGrzPrincipalBasis(tx, actor, bondId);
    });
    expect(evidence).toBeNull();
  });

  it("actor-scopes a new private custody acquisition audit", async () => {
    await db.update(accounts).set({ isPrivate: true, ownerUserId: userId }).where(eq(accounts.id, accountId));
    const key = randomUUID(); await record({ operationId: key }).expect(201);
    const audit = await pool.query<{ household_id: string | null; user_id: string }>(`select household_id,user_id from audit_logs
      where entity_id=$1 and details->'newValue'->>'operationId'=$2`, [bondId, key]);
    expect(audit.rows).toEqual([{ household_id: null, user_id: userId }]);
  });

  it("normalises a genuine cross-bond/account same-operation insert race to one record and a conflict", async () => {
    const secondAccount = randomUUID(), secondBond = randomUUID(), key = randomUUID();
    await db.insert(accounts).values({ id: secondAccount, householdId, name: "Synthetic second custody", type: "investment", currency: "ZMW", isAsset: true });
    await db.insert(grzBonds).values({ id: secondBond, householdId, accountId: secondAccount, isin, bondName: "Synthetic competing basis", tenorYears: 5,
      faceValue: "1000.00", purchasePrice: "950.00", couponRate: "0.0000", purchaseDate: "2025-06-30", maturityDate: "2030-06-30" });
    let release!: () => void, arrivals = 0;
    const gate = new Promise<void>(done => { release = done; });
    const original = Client.prototype.query;
    const intercept = function(this: Client, ...args: unknown[]) {
      const command = args[0], statement = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
      if (/insert into "grz_bond_principal_basis"/i.test(statement)) {
        arrivals++; if (arrivals === 2) release();
        return gate.then(() => Reflect.apply(original, this, args));
      }
      return Reflect.apply(original, this, args);
    };
    vi.spyOn(Client.prototype, "query").mockImplementation(intercept as typeof Client.prototype.query);
    const timer = setTimeout(release, 3000);
    try {
      const results = await Promise.all([record({ operationId: key }).then(value => value), record({ operationId: key }, secondBond).then(value => value)]);
      expect(arrivals).toBe(2); expect(results.map(value => value.status).sort()).toEqual([201, 409]);
    } finally { clearTimeout(timer); release(); }
    const rows = await pool.query("select id from grz_bond_principal_basis where household_id=$1 and operation_id=$2", [householdId, key]);
    expect(rows.rows).toHaveLength(1);
  }, 15_000);

  it("projects a fixed instant across the Lusaka calendar boundary without changing either clock", async () => {
    const instant = "2025-12-31T22:30:00Z";
    const { rows } = await pool.query<{ utc_day: string; lusaka_day: string }>(
      `select ($1::timestamptz at time zone 'UTC')::date::text as utc_day,
        ($1::timestamptz at time zone 'Africa/Lusaka')::date::text as lusaka_day`, [instant],
    );
    expect(rows).toEqual([{ utc_day: "2025-12-31", lusaka_day: "2026-01-01" }]);
    expect(householdCalendarDate(new Date(instant), "Africa/Lusaka")).toBe(rows[0].lusaka_day);
  });

  it("keeps the legacy UTC day and refuses an unsupported stored zone at the API and insert guard", async () => {
    await record({ operationId: randomUUID(), sourceDate: date }).expect(201);
    await record({ operationId: randomUUID(), sourceDate: shiftCalendarDate(date, 2) }).expect(400);
    await request(app).put("/api/investments/calendar").set("Cookie", cookie)
      .set("X-Capital-Subject", userId).set("X-Capital-Household", householdId).send({ timeZone: "UTC+02" }).expect(400);
    expect((await db.select({ zone: households.timeZone }).from(households).where(eq(households.id, householdId)))[0].zone).toBeNull();
    const before = await stored();
    const probe = copiedInsert("Synthetic invalid calendar insert", userId);
    probe.values![0] = await latestId();
    await db.update(households).set({ timeZone: "UTC+02" }).where(eq(households.id, householdId));
    const refused = await record({ operationId: randomUUID(), sourceDate: date }).expect(422);
    expect(refused.body.error.code).toBe("HOUSEHOLD_CALENDAR_UNAVAILABLE");
    await expect(restricted([probe], true)).rejects.toMatchObject({ code: "23514" });
    expect(await stored()).toEqual(before);
  });
});
