import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accounts, auditLogs, transactions } from "@shared/schema";
import { db, pool } from "../../../db";
import { a, actors, app, reset, start, stop, type Role } from "../../tags/__tests__/completion-r04.tags.fixture";

// C3-16: an allowed opening-balance edit on a history-free account changes both
// initialBalance and balance. Its one audit row must carry the old and new
// opening balance next to the balances, for shared and private custody.
const trigger = `c3_16_opening_${randomUUID().replaceAll("-", "")}`;
type Custody = "shared" | "private";
type Edit = { custody: Custody; from: string; to: string };
const edits: Edit[] = (["shared", "private"] as const).flatMap(custody => [
  { custody, from: "100.00", to: "0.00" },
  { custody, from: "0.00", to: "100.00" },
]);

const signed = (call: request.Test, role: Role = "owner") => call
  .set("Cookie", actors.get(role)!.cookie)
  .set("X-Capital-Subject", actors.get(role)!.id).set("X-Capital-Household", a);
const editOpening = (id: string, initialBalance: string, role: Role = "owner") =>
  signed(request(app).put(`/api/accounts/${id}`), role).send({ initialBalance });

/** A history-free account: no ledger rows, balance equal to its opening basis. */
async function seedAccount(custody: Custody, opening: string): Promise<string> {
  const id = randomUUID();
  await db.insert(accounts).values({ id, householdId: a, name: `C3-16 ${custody.toUpperCase()}`, type: "checking",
    currency: "ZMW", initialBalance: opening, balance: opening, isPrivate: custody === "private",
    ownerUserId: actors.get("owner")!.id });
  return id;
}
async function accountRow(id: string) {
  return (await pool.query("select initial_balance, balance, updated_at from accounts where id=$1", [id])).rows[0];
}
async function auditsFor(id: string) {
  return (await pool.query("select * from audit_logs where entity_id=$1 order by created_at, id", [id])).rows;
}
/** A reader's view of one side of an account audit: a missing property is unknown, never zero. */
const openingOf = (side: Record<string, unknown>) => ("initialBalance" in side ? side.initialBalance : "unknown");

async function dropFailure() {
  await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON audit_logs; DROP FUNCTION IF EXISTS ${trigger}()`);
}
async function rejectAccountAuditsByOwner() {
  await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.user_id='${actors.get("owner")!.id}'::uuid AND NEW.entity_type='account' THEN
        RAISE EXCEPTION 'Synthetic mandatory account audit failure';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
}

describe("C3-16 opening-balance edits are kept in the account audit", () => {
  beforeAll(async () => { await start(); }, 30_000);
  beforeEach(async () => { await dropFailure(); await reset(); });
  afterEach(async () => { await dropFailure(); });
  afterAll(async () => { await dropFailure(); await stop(); });

  it.each(edits)("a $custody opening edit $from -> $to audits the old and new opening balance", async edit => {
    const id = await seedAccount(edit.custody, edit.from);
    const result = await editOpening(id, edit.to);
    expect(result.status).toBe(200);
    expect(await accountRow(id)).toMatchObject({ initial_balance: edit.to, balance: edit.to });

    const rows = await auditsFor(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ household_id: edit.custody === "private" ? null : a,
      user_id: actors.get("owner")!.id, action: "UPDATE", entity_type: "account" });
    const { oldValue, newValue, changes } = rows[0].details;
    expect({ old: openingOf(oldValue), new: openingOf(newValue) }).toEqual({ old: edit.from, new: edit.to });
    expect({ old: oldValue.balance, new: newValue.balance }).toEqual({ old: edit.from, new: edit.to });
    expect(changes).toMatchObject({ initialBalance: { from: edit.from, to: edit.to }, balance: { from: edit.from, to: edit.to } });
  });

  it("a household peer can neither edit a private account's opening nor see its audit", async () => {
    const id = await seedAccount("private", "100.00");
    const peerEdit = await editOpening(id, "0.00", "member");
    expect(peerEdit.status).toBe(404);
    expect(await accountRow(id)).toMatchObject({ initial_balance: "100.00", balance: "100.00" });
    expect(await auditsFor(id)).toHaveLength(0);

    await editOpening(id, "0.00").expect(200);
    const [row] = await auditsFor(id);
    expect(row).toMatchObject({ household_id: null, user_id: actors.get("owner")!.id });
    // Household-scoped audit reads never reach the owner-only row.
    const household = await pool.query("select id from audit_logs where household_id=$1 and entity_id=$2", [a, id]);
    expect(household.rows).toHaveLength(0);
    await signed(request(app).get(`/api/accounts/${id}`), "member").expect(404);
  });

  it("an account with transaction history still refuses the opening edit, with no audit row", async () => {
    const id = await seedAccount("shared", "100.00");
    await db.insert(transactions).values({ householdId: a, accountId: id, ownerUserId: actors.get("owner")!.id,
      date: "2026-10-05", name: "C3-16 history", amount: "5.00", type: "expense", currency: "ZMW", isPrivate: false });
    const before = await accountRow(id);
    const result = await editOpening(id, "0.00");
    expect(result.status).toBe(409);
    expect(await accountRow(id)).toEqual(before);
    expect(await auditsFor(id)).toHaveLength(0);
  });

  it.each(["shared", "private"] as const)("a refused audit insert rolls back the %s opening edit", async custody => {
    const id = await seedAccount(custody, "100.00");
    const before = await accountRow(id);
    await rejectAccountAuditsByOwner();
    const result = await editOpening(id, "0.00");
    expect.soft(result.status).toBe(500);
    expect(await accountRow(id)).toEqual(before);
    expect(await auditsFor(id)).toHaveLength(0);
  });

  it("a historical audit row without opening fields stays unknown and is not rewritten", async () => {
    const id = await seedAccount("shared", "100.00");
    // The pre-C3-16 shape: balances only, no initialBalance on either side.
    await db.insert(auditLogs).values({ householdId: a, userId: actors.get("owner")!.id, action: "UPDATE",
      entityType: "account", entityId: id, details: { oldValue: { name: "C3-16 SHARED", balance: "100.00" },
        newValue: { name: "C3-16 SHARED", balance: "100.00" }, changes: null } });
    const [historical] = await auditsFor(id);

    await editOpening(id, "0.00").expect(200);
    const rows = await auditsFor(id);
    expect(rows).toHaveLength(2);
    const kept = rows.find(row => row.id === historical.id)!;
    expect(kept).toEqual(historical);
    expect({ old: openingOf(kept.details.oldValue), new: openingOf(kept.details.newValue) })
      .toEqual({ old: "unknown", new: "unknown" });
    const fresh = rows.find(row => row.id !== historical.id)!;
    expect({ old: openingOf(fresh.details.oldValue), new: openingOf(fresh.details.newValue) })
      .toEqual({ old: "100.00", new: "0.00" });
  });
});
