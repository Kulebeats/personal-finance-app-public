import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { accountWorthCaptures, accounts, households, netWorthSnapshots } from "@shared/schema";
import { db } from "../../../db";
import { snapshotWorker } from "../../../jobs/snapshotWorker";
import { readNativeAccountCapture, persistNativeAccountCapture } from "../../../jobs/accountCapture";
import { createSnapshotProvenance } from "../../../jobs/snapshotProvenance";
import { a, actors, app, ids, reset, start, stop } from "../../tags/__tests__/completion-r04.tags.fixture";

const extraId = randomUUID();
let date: string, past: string;
function history(viewer: "member" | "owner" = "member", includeAccounts = false) {
  return request(app).get(`/api/accounts/net-worth/history?dateRange=all&includeAccounts=${includeAccounts}`)
    .set("Cookie", actors.get(viewer)!.cookie);
}
async function clean() {
  await db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
  await db.delete(accountWorthCaptures).where(eq(accountWorthCaptures.householdId, a));
  await db.delete(accounts).where(eq(accounts.id, extraId));
}
/** Explicit old-format fixture; it is not a newly attested historical native receipt. */
function legacy(captureId: ReturnType<typeof randomUUID>, amount: string) {
  const contributions = [
    { accountId: ids.sharedAccount, kind: "asset" as const, accountType: "checking", baseAmount: amount, sourceCurrency: "ZMW", baseCurrency: "ZMW", fx: "same_currency" as const },
    { accountId: ids.privateAccount, kind: "asset" as const, accountType: "savings", baseAmount: "200", sourceCurrency: "ZMW", baseCurrency: "ZMW", fx: "same_currency" as const },
  ];
  return { householdId: a, date: past, currency: "ZMW", totalAssets: String(Number(amount) + 200), totalLiabilities: "0", netWorth: String(Number(amount) + 200),
    accountBalances: contributions.map(item => ({ accountId: item.accountId, balance: item.baseAmount })),
    provenance: createSnapshotProvenance(a, past, "ZMW", { holdings: 0, tbills: 0, pensions: 0, bonds: 0 }, contributions, 0, captureId) };
}
function beforePublication(change: () => Promise<unknown>) {
  const actual = Client.prototype.query, gate = vi.fn(change);
  let changed = false;
  const intercepted = function(this: Client, ...args: unknown[]) {
    const command = args[0];
    const text = typeof command === "string" ? command : command && typeof command === "object" && "text" in command ? String(command.text) : "";
    if (!changed && /^\s*with\b/i.test(text) && ['"household_members"', '"provider_fx_quotes"', '"net_worth_snapshots"'].every(table => text.includes(table))) {
      changed = true; return gate().then(() => Reflect.apply(actual, this, args));
    }
    return Reflect.apply(actual, this, args);
  };
  vi.spyOn(Client.prototype, "query").mockImplementation(intercepted as typeof Client.prototype.query);
  return gate;
}

describe("R04 publication uses current legacy content and permitted account DTOs", () => {
  beforeAll(async () => {
    await start();
    const clock = await db.execute<{ date: string }>(sql`select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD') as date`);
    date = clock.rows[0].date;
    const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); past = value.toISOString().slice(0, 10);
  }, 20_000);
  beforeEach(async () => {
    await clean(); await reset();
    await db.update(households).set({ currency: "ZMW" }).where(eq(households.id, a));
    await db.update(accounts).set({ balance: "100", currency: "ZMW" }).where(eq(accounts.id, ids.sharedAccount));
    await db.update(accounts).set({ balance: "200", currency: "ZMW" }).where(eq(accounts.id, ids.privateAccount));
  });
  afterEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await stop(); });

  it.each(["G-H-G update", "delete and reinsert"] as const)("detects changed legacy money after %s reuses the same row and capture ID", async mode => {
    const g = randomUUID(), h = randomUUID();
    const [row] = await db.insert(netWorthSnapshots).values(legacy(g, "100")).returning();
    const gate = beforePublication(async () => {
      if (mode === "G-H-G update") {
        await db.update(netWorthSnapshots).set(legacy(h, "110")).where(eq(netWorthSnapshots.id, row.id));
        await db.update(netWorthSnapshots).set(legacy(g, "120")).where(eq(netWorthSnapshots.id, row.id));
      } else {
        await db.delete(netWorthSnapshots).where(eq(netWorthSnapshots.id, row.id));
        await db.insert(netWorthSnapshots).values({ id: row.id, ...legacy(g, "120") });
      }
    });
    const response = await history().expect(200);
    expect(gate).toHaveBeenCalledOnce();
    expect(response.body.data.series).toEqual([expect.objectContaining({ date: past, currency: "ZMW", netWorth: 120 })]);
  });
  it("publishes scrubbed fields, available balance and current order from the final permitted DTO snapshot", async () => {
    await db.update(accounts).set({ name: "Old label", notes: "Scrubbed note", address: "Scrubbed address", availableBalance: "10", displayOrder: 1 })
      .where(eq(accounts.id, ids.sharedAccount));
    await db.insert(accounts).values({ id: extraId, householdId: a, name: "Other account", type: "checking", currency: "ZMW", balance: "10", displayOrder: 2 });
    const transactions = vi.spyOn(db, "transaction");
    const gate = beforePublication(async () => {
      await db.update(accounts).set({ name: "Current label", notes: null, address: null, availableBalance: "77.77", displayOrder: 3 })
        .where(eq(accounts.id, ids.sharedAccount));
      await db.update(accounts).set({ displayOrder: 0 }).where(eq(accounts.id, extraId));
    });
    const response = await history("member", true).expect(200);
    expect(gate).toHaveBeenCalledOnce();
    expect(response.body.data.accounts.map((account: { id: string }) => account.id)).toEqual([extraId, ids.sharedAccount]);
    expect(response.body.data.accounts[1]).toMatchObject({ name: "Current label", notes: null, address: null, availableBalance: "77.77" });
    expect(response.body.data.latest.netWorth).toBe(110);
    expect(JSON.stringify(response.body.data)).not.toMatch(/Scrubbed note|Scrubbed address|Old label/);
    expect(transactions).toHaveBeenCalledOnce(); // Scalar values did not need reassembly.
  });
  it("preserves the complete prior household receipt after a known failed refresh", async () => {
    expect(await snapshotWorker.processHousehold(a)).toBe(true);
    const before = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
    await db.update(accounts).set({ currency: "QPX" }).where(eq(accounts.id, ids.privateAccount));
    await expect(snapshotWorker.processHousehold(a)).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
    expect(await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a))).toEqual(before);
    expect((await history("owner").expect(200)).body.data.series).toEqual([]);
    expect((await history().expect(200)).body.data.series).toEqual([expect.objectContaining({ date, currency: "ZMW", netWorth: 100 })]);
  });
  it("does not fall back from a newer undecodable scoped observation to an unrelated older global generation", async () => {
    expect(await snapshotWorker.processHousehold(a)).toBe(true);
    const before = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a));
    await db.update(accounts).set({ currency: "QPX" }).where(eq(accounts.id, ids.sharedAccount));
    // This is the real guarded independent writer, not a fabricated proof. Its
    // current DB observation cannot value this visible source in ZMW.
    await db.transaction(async tx => persistNativeAccountCapture(tx, await readNativeAccountCapture(tx, a)), { isolationLevel: "serializable" });
    expect(await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, a))).toEqual(before);
    expect((await history().expect(200)).body.data).toMatchObject({ series: [], latest: null, currentStatus: "unavailable" });
  });
});
