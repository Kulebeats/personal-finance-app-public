/**
 * NEW-24: a pension contribution is validated, atomic and audited (Rule 9).
 * REAL HTTP, REAL DB.
 *
 * The holding's currency is its linked account's currency (here ZMW).
 *
 * Astra A-56: a pension held in a member's private account is that member's.
 * A household peer cannot list it, read its contributions or contribute to it
 * (404, nothing written); the owner still can, with the audit row.
 *
 * NEW-24 follow-up: a contribution moves no ledger cash, so the response and the
 * audit row both say `cashMoved: false`; an unexpected failure answers the shared
 * generic 500, never the raw error text.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pensionContributions, pensionHoldings } from "@shared/schema";
import { db, pool } from "../../db";
import { a, b, actors, app, ids, reset, start, stop, type Role } from "../../modules/tags/__tests__/completion-r04.tags.fixture";

const money = (amount: string, currency = "ZMW") => ({ amount, currency });
const body = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-11-01",
  employeeContribution: money("100.00"),
  employerContribution: money("50.00"),
  totalContribution: money("150.00"),
  ...overrides,
});
const signed = (call: request.Test, role: Role = "owner") => call
  .set("Cookie", actors.get(role)!.cookie).set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const post = (holdingId: string, payload: unknown, role: Role = "owner") =>
  signed(request(app).post(`/api/investments/pension/${holdingId}/contributions`), role).send(payload as object);
const list = (role: Role) => signed(request(app).get("/api/investments/pension"), role);
const contributionsOf = (holdingId: string, role: Role) =>
  signed(request(app).get(`/api/investments/pension/${holdingId}/contributions`), role);
const createHolding = (accountId: string, role: Role) => signed(request(app).post("/api/investments/pension"), role)
  .send({ accountId, providerName: "Synthetic pension", pensionType: "private", currentBalance: "321.00" });

let holdingId: string;
let foreignHoldingId: string;
let privateHoldingId: string;

async function clean() {
  await db.delete(pensionHoldings).where(inArray(pensionHoldings.householdId, [a, b]));
  await pool.query("delete from audit_logs where household_id=$1", [a]);
}

const state = async (id = holdingId) => {
  const [holding] = (await pool.query("select current_balance from pension_holdings where id=$1", [id])).rows;
  const contributions = (await pool.query("select id from pension_contributions where pension_holding_id=$1", [id])).rows;
  const audits = (await pool.query("select * from audit_logs where entity_type='pension_contribution' and details->>'pensionHoldingId'=$1 order by id", [id])).rows;
  return { balance: holding.current_balance as string, contributions: contributions.length, audits };
};

describe("NEW-24 pension contribution (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    holdingId = randomUUID(); foreignHoldingId = randomUUID();
    await db.insert(pensionHoldings).values([
      { id: holdingId, householdId: a, accountId: ids.sharedAccount, providerName: "NAPSA", pensionType: "social_security", currentBalance: "1000.00" },
      { id: foreignHoldingId, householdId: b, providerName: "Foreign fund", pensionType: "private", currentBalance: "0.00" },
    ]);
  });
  afterAll(async () => {
    await pool.query("drop trigger if exists block_pension_audit on audit_logs");
    await pool.query("drop function if exists block_pension_audit()");
    await clean();
    await stop();
  });

  it("records a valid contribution: row, balance and one audit row with before and after", async () => {
    const res = await post(holdingId, body());
    expect(res.status).toBe(201);
    expect(res.body.data.totalContribution).toBe("150.00");
    expect(res.body.data.cashMoved).toBe(false);

    const { balance, contributions, audits } = await state();
    expect(balance).toBe("1150.00");
    expect(contributions).toBe(1);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("CREATE");
    expect(audits[0].user_id).toBe(actors.get("owner")!.id);
    expect(audits[0].entity_id).toBe(res.body.data.id);
    expect(audits[0].details.newValue.totalContribution).toBe("150.00");
    expect(audits[0].details.pensionHoldingId).toBe(holdingId);
    expect(audits[0].details.balanceBefore).toBe("1000.00");
    expect(audits[0].details.balanceAfter).toBe("1150.00");
    expect(audits[0].details.cashMoved).toBe(false);
  });

  it.each([
    ["a negative total", { totalContribution: money("-150.00") }],
    ["a zero total", { totalContribution: money("0.00") }],
    ["a negative employee amount", { employeeContribution: money("-10.00"), totalContribution: money("40.00") }],
    ["a currency that is not the pension's", {
      employeeContribution: money("100.00", "USD"), employerContribution: money("50.00", "USD"), totalContribution: money("150.00", "USD"),
    }],
    ["mixed currencies", { employerContribution: money("50.00", "USD") }],
    ["a total that is not employee plus employer", { totalContribution: money("151.00") }],
    ["an impossible date", { date: "2026-02-30" }],
    ["a missing amount", { employeeContribution: undefined }],
  ])("refuses %s with 400 and writes nothing", async (_label, overrides) => {
    const before = await state();
    const res = await post(holdingId, body(overrides));
    expect(res.status).toBe(400);
    expect(await state()).toEqual(before);
  });

  it("does not let a household write to another household's holding", async () => {
    const res = await post(foreignHoldingId, body());
    expect(res.status).toBe(404);
    const rows = await db.select().from(pensionContributions).where(inArray(pensionContributions.pensionHoldingId, [foreignHoldingId]));
    expect(rows).toHaveLength(0);
  });

  it("refuses a view-only member", async () => {
    const res = await post(holdingId, body(), "view_only");
    expect(res.status).toBe(403);
    expect((await state()).contributions).toBe(0);
  });

  it("is atomic: when the audit insert fails the contribution and the balance change roll back", async () => {
    await pool.query(`create or replace function block_pension_audit() returns trigger language plpgsql as $$
      begin
        if new.entity_type = 'pension_contribution' then raise exception 'audit blocked for test'; end if;
        return new;
      end $$`);
    await pool.query("create trigger block_pension_audit before insert on audit_logs for each row execute function block_pension_audit()");
    try {
      const res = await post(holdingId, body());
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
      expect(res.text).not.toContain("audit blocked for test");
      expect(await state()).toEqual({ balance: "1000.00", contributions: 0, audits: [] });
    } finally {
      await pool.query("drop trigger if exists block_pension_audit on audit_logs");
    }
  });

  it("answers an unexpected failure creating a pension with the generic 500, not the raw error", async () => {
    await pool.query(`create or replace function block_pension_audit() returns trigger language plpgsql as $$
      begin
        if new.entity_type = 'pension_holding' then raise exception 'holding audit blocked for test'; end if;
        return new;
      end $$`);
    await pool.query("create trigger block_pension_audit before insert on audit_logs for each row execute function block_pension_audit()");
    try {
      const res = await createHolding(ids.sharedAccount, "owner");
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ success: false, error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
      expect(res.text).not.toContain("holding audit blocked for test");
    } finally {
      await pool.query("drop trigger if exists block_pension_audit on audit_logs");
    }
  });
});

describe("Astra A-56: a pension in a member's private account is that member's (real HTTP/DB)", () => {
  beforeAll(start, 30_000);
  beforeEach(async () => {
    await clean(); await reset();
    holdingId = randomUUID(); privateHoldingId = randomUUID();
    await db.insert(pensionHoldings).values([
      { id: holdingId, householdId: a, accountId: ids.sharedAccount, providerName: "NAPSA", pensionType: "social_security", currentBalance: "1000.00" },
      { id: privateHoldingId, householdId: a, accountId: ids.privateAccount, providerName: "PRIVPENSION fund", pensionType: "private", currentBalance: "2000.00" },
    ]);
    await db.insert(pensionContributions).values({ pensionHoldingId: privateHoldingId, date: "2026-10-01",
      employeeContribution: "70.00", employerContribution: "30.00", totalContribution: "100.00" });
  });
  afterAll(async () => {
    await clean();
    await stop();
  });

  it("a household peer's list leaves out the private pension; the owner's list includes it", async () => {
    const peer = await list("member").expect(200);
    const owner = await list("owner").expect(200);

    const idsOf = (res: request.Response) => (res.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(idsOf(peer)).toContain(holdingId);
    expect(idsOf(peer)).not.toContain(privateHoldingId);
    expect(JSON.stringify(peer.body)).not.toContain("PRIVPENSION");
    expect(idsOf(owner)).toEqual(expect.arrayContaining([holdingId, privateHoldingId]));
  });

  it("a household peer gets 404 for the private pension's contributions; the owner reads them", async () => {
    const peer = await contributionsOf(privateHoldingId, "member");
    expect(peer.status).toBe(404);
    expect(JSON.stringify(peer.body)).not.toContain("100.00");

    const owner = await contributionsOf(privateHoldingId, "owner").expect(200);
    expect((owner.body.data as Array<{ totalContribution: string }>).map((row) => row.totalContribution)).toEqual(["100.00"]);
  });

  it("uses one statement for history visibility and amounts, including an empty visible holding", async () => {
    await contributionsOf(holdingId, "member").expect(200, { success: true, data: [] });
    const queries = vi.spyOn(pool, "query");
    try {
      await contributionsOf(privateHoldingId, "owner").expect(200);
      const statements = queries.mock.calls.flatMap(([query]: readonly unknown[]) => {
        if (typeof query === "string") return [query];
        if (query && typeof query === "object" && "text" in query && typeof query.text === "string") {
          return [query.text];
        }
        return [];
      });
      const pensionReads = statements.filter(query => /from "(pension_holdings|pension_contributions)"/i.test(query));
      expect(pensionReads).toHaveLength(1);
      expect(pensionReads[0]).toContain('join "pension_contributions"');
    } finally {
      queries.mockRestore();
    }
  });

  it("denies creating a pension on another member's private account and keeps the owner's audit personal", async () => {
    const missing = await createHolding(randomUUID(), "member").expect(404);
    const denied = await createHolding(ids.privateAccount, "member").expect(404);
    expect(denied.body.error).toEqual(missing.body.error);
    const created = await createHolding(ids.privateAccount, "owner").expect(200);
    expect(created.body.data).toMatchObject({ accountId: ids.privateAccount, currentBalance: "321.00" });
    const { rows } = await pool.query("select household_id, user_id, details from audit_logs where entity_type='pension_holding' and entity_id=$1",
      [created.body.data.id]);
    expect(rows).toEqual([expect.objectContaining({ household_id: null, user_id: actors.get("owner")!.id })]);
  });

  it("a household peer cannot contribute to the private pension: 404 and nothing changes", async () => {
    const before = await state(privateHoldingId);

    const res = await post(privateHoldingId, body(), "member");

    expect(res.status).toBe(404);
    expect(await state(privateHoldingId)).toEqual(before);
    expect(before.balance).toBe("2000.00");
  });

  it("the owner still contributes to their private pension, with the audit row", async () => {
    const res = await post(privateHoldingId, body(), "owner");

    expect(res.status).toBe(201);
    const after = await state(privateHoldingId);
    expect(after.balance).toBe("2150.00");
    expect(after.contributions).toBe(2);
    const audit = after.audits.find((row) => row.entity_id === res.body.data.id);
    expect(audit?.user_id).toBe(actors.get("owner")!.id);
    expect(audit?.household_id).toBeNull();
    expect(audit?.details.pensionHoldingId).toBe(privateHoldingId);
    expect(audit?.details.balanceAfter).toBe("2150.00");
  });

  it.each(["role", "custody"] as const)("waits for a concurrent %s change then refuses the stale contribution", async change => {
    const before = await state();
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let settled = false;
    let waiting = false;
    try {
      await blocker.query("BEGIN");
      const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      if (change === "role") {
        await blocker.query("UPDATE household_members SET role='view_only' WHERE household_id=$1 AND user_id=$2",
          [a, actors.get("member")!.id]);
      } else {
        await blocker.query("UPDATE accounts SET is_private=true WHERE id=$1", [ids.sharedAccount]);
      }
      pending = post(holdingId, body(), "member").timeout(10_000).then(response => response)
        .finally(() => { settled = true; });
      void pending.catch(() => undefined);
      const deadline = Date.now() + 5_000;
      while (!waiting && !settled && Date.now() < deadline) {
        const { rows: [row] } = await pool.query<{ waiting: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS waiting", [pid]);
        waiting = row.waiting;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      await blocker.query("COMMIT");
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      if (pending) await Promise.allSettled([pending]);
    }
    expect(waiting).toBe(true);
    expect((await pending!).status).toBe(change === "role" ? 403 : 404);
    expect(await state()).toEqual(before);
  }, 15_000);
});
