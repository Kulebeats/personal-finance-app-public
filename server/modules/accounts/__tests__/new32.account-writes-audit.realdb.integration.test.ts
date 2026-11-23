import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { accounts, households } from "@shared/schema";
import { db, pool } from "../../../db";
import { calendarClock } from "../../../services/householdCalendarToday";
import { a, actors, app, ids, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

// NEW-32 / FIN-13: every account write and its one audit row commit in one
// transaction. A failing audit insert must leave no write behind.
const trigger = `new32_account_${randomUUID().replaceAll("-", "")}`;
const password = "SyntheticR04Tags123!";
// 22:30 UTC on 5 Oct is already 6 Oct in Lusaka (UTC+2).
const pinnedInstant = new Date("2026-10-05T22:30:00Z");

const signed = (call: request.Test, role: Role = "member") => call
  .set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);

type AccountWrite = {
  name: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  entityType: "account" | "transaction" | "balance_history_import";
  prepare?: () => Promise<void>;
  send: () => request.Test;
};

const writes: AccountWrite[] = [
  { name: "update", action: "UPDATE", entityType: "account",
    send: () => signed(request(app).put(`/api/accounts/${ids.sharedAccount}`)).send({ name: "NEW32 renamed" }) },
  { name: "settings", action: "UPDATE", entityType: "account",
    send: () => signed(request(app).patch(`/api/accounts/${ids.sharedAccount}/settings`)).send({ isHidden: true }) },
  { name: "archive", action: "UPDATE", entityType: "account",
    send: () => signed(request(app).post(`/api/accounts/${ids.sharedAccount}/archive`)) },
  { name: "unarchive", action: "UPDATE", entityType: "account",
    prepare: async () => { await db.update(accounts).set({ isArchived: true }).where(eq(accounts.id, ids.sharedAccount)); },
    send: () => signed(request(app).post(`/api/accounts/${ids.sharedAccount}/unarchive`)) },
  { name: "adjust-balance", action: "CREATE", entityType: "transaction",
    send: () => signed(request(app).post(`/api/accounts/${ids.sharedAccount}/adjust-balance`))
      .send({ amount: "10.00", isIncrease: true }) },
  { name: "balance-history import", action: "CREATE", entityType: "balance_history_import",
    send: () => signed(request(app).post(`/api/accounts/${ids.sharedAccount}/balance-history/import`))
      .send({ data: [{ date: "2026-10-01", amount: "900.00" }] }) },
  { name: "delete", action: "DELETE", entityType: "account",
    prepare: async () => {
      await signed(request(app).post("/api/settings/security/step-up")).send({ password }).expect(200);
    },
    send: () => signed(request(app).delete(`/api/accounts/${ids.sharedAccount}`)) },
];

async function state() {
  const actorIds = Array.from(actors.values(), actor => actor.id);
  return {
    accounts: (await pool.query("select * from accounts where household_id=$1 order by id", [a])).rows,
    transactions: (await pool.query("select * from transactions where household_id=$1 order by id", [a])).rows,
    snapshots: (await pool.query("select s.* from account_balance_snapshots s join accounts x on x.id=s.account_id where x.household_id=$1 order by s.account_id,s.date", [a])).rows,
    audits: (await pool.query("select * from audit_logs where household_id=$1 or user_id=any($2::uuid[]) order by id", [a, actorIds])).rows,
  };
}
type State = Awaited<ReturnType<typeof state>>;
const added = (before: State, after: State) => after.audits.filter(row => !before.audits.some(prior => prior.id === row.id));

async function dropFailure() {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}()`);
}
async function rejectAuditsBy(role: Role) {
  await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id='${actors.get(role)!.id}'::uuid THEN
        RAISE EXCEPTION 'Synthetic mandatory account audit failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}

describe("NEW-32 account writes commit with exactly one audit row", () => {
  beforeAll(async () => {
    await start();
    await db.update(households).set({ timeZone: "Africa/Lusaka" }).where(eq(households.id, a));
  }, 30_000);
  beforeEach(async () => {
    await dropFailure();
    await reset();
    await pool.query("delete from account_balance_snapshots where account_id=$1", [ids.sharedAccount]);
    vi.spyOn(calendarClock, "now").mockReturnValue(pinnedInstant);
  });
  afterEach(async () => { vi.restoreAllMocks(); await dropFailure(); });
  afterAll(async () => { await dropFailure(); await stop(); });

  it.each(writes)("$name writes one $action $entityType audit row with the write", async write => {
    await write.prepare?.();
    const before = await state();
    const result = await write.send();
    expect(result.status).toBe(200);
    const after = await state();
    const rows = added(before, after);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ household_id: a, user_id: actors.get("member")!.id,
      action: write.action, entity_type: write.entityType });
    if (write.entityType === "account" || write.entityType === "balance_history_import") {
      expect(rows[0].entity_id).toBe(ids.sharedAccount);
    }
    if (write.name === "settings") expect(rows[0].details.operation).toBe("updateSettings");
  });

  it.each(writes)("$name leaves no write behind when its audit insert fails", async write => {
    await write.prepare?.();
    const before = await state();
    await rejectAuditsBy("member");
    const result = await write.send();
    expect.soft(result.status).toBe(500);
    expect(await state()).toEqual(before);
  });

  it("adjust-balance audits its ledger row in the same transaction, dated on the household calendar", async () => {
    const before = await state();
    const result = await signed(request(app).post(`/api/accounts/${ids.sharedAccount}/adjust-balance`))
      .send({ amount: "10.00", isIncrease: true }).expect(200);
    const after = await state();
    const ledger = after.transactions.filter(row => !before.transactions.some(prior => prior.id === row.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ id: result.body.data.transactionId, account_id: ids.sharedAccount,
      type: "balance_adjustment", amount: "10.00" });
    // A raw pg date column parses to a JS Date; compare the calendar date as text.
    const [{ day }] = (await pool.query("select date::text as day from transactions where id=$1", [ledger[0].id])).rows;
    expect(day).toBe("2026-10-06");
    expect(after.accounts.find(row => row.id === ids.sharedAccount)!.balance).toBe("998.89");
    const rows = added(before, after);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "CREATE", entity_type: "transaction", entity_id: ledger[0].id });
  });

  it("adjust-balance leaves the balance unchanged when its audit insert fails", async () => {
    const before = await state();
    await rejectAuditsBy("member");
    const result = await signed(request(app).post(`/api/accounts/${ids.sharedAccount}/adjust-balance`))
      .send({ amount: "10.00", isIncrease: false });
    expect.soft(result.status).toBe(500);
    const after = await state();
    expect(after.accounts.find(row => row.id === ids.sharedAccount)!.balance).toBe("988.89");
    expect(after).toEqual(before);
  });

  // Lock order: ledger writers (adjust-balance, transaction create, transfers,
  // GRZ, goals) lock the account row FOR UPDATE, then key-share the household
  // through their rows' household FK. An account writer that held the household
  // FOR UPDATE while waiting for the account would deadlock with them (40P01).
  it.each(writes)("$name waits on a held account row holding no household lock, then completes", async write => {
    await write.prepare?.();
    const before = await state();
    const side = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await side.query("BEGIN");
      const sidePid = (await side.query("select pg_backend_pid() as pid")).rows[0].pid;
      await side.query("select id from accounts where id=$1 for update", [ids.sharedAccount]);
      pending = write.send().then(result => result);
      let isWaiting = false;
      for (let tries = 0; tries < 100 && !isWaiting; tries++) {
        const blocked = await pool.query(
          "select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [sidePid]);
        isWaiting = blocked.rows.length > 0;
        if (!isWaiting) await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(isWaiting).toBe(true);
      // What a ledger writer on this account does next; NOWAIT fails at once
      // if the waiting writer already holds the household FOR UPDATE.
      await side.query("select id from households where id=$1 for key share nowait", [a]);
      await side.query("COMMIT");
      const result = await pending;
      expect(result.status).toBe(200);
      expect(added(before, await state())).toHaveLength(1);
    } finally {
      await side.query("ROLLBACK").catch(() => undefined);
      side.release();
      // A RED run must not leave the request running into the next test.
      await pending?.catch(() => undefined);
    }
  });

  it("archiving a private account writes one owner-only audit row", async () => {
    const before = await state();
    await signed(request(app).post(`/api/accounts/${ids.privateAccount}/archive`), "owner").expect(200);
    const rows = added(before, await state());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ household_id: null, user_id: actors.get("owner")!.id,
      action: "UPDATE", entity_type: "account", entity_id: ids.privateAccount });
  });

  it("a private account's settings change writes one owner-only audit row", async () => {
    const before = await state();
    await signed(request(app).patch(`/api/accounts/${ids.privateAccount}/settings`), "owner")
      .send({ isHidden: true }).expect(200);
    const rows = added(before, await state());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ household_id: null, user_id: actors.get("owner")!.id,
      action: "UPDATE", entity_type: "account", entity_id: ids.privateAccount });
    expect(rows[0].details.operation).toBe("updateSettings");
  });
});
