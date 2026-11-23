// A-47 (P0 privacy): the net-worth report's stored history and breakdown show
// each viewer only the accounts that viewer may see now. A peer (owner or
// admin role included) never sees another member's private savings, neither
// in a total nor in the by-type breakdown, and no two figures it is given
// differ by the private amount. Real HTTP + Postgres + worker.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import Decimal from "decimal.js";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, fxRates, netWorthSnapshots, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { analyticsCache } from "../../../services/AnalyticsCache";
import { snapshotWorker } from "../../../jobs/snapshotWorker";

type Role = "owner" | "admin" | "member";
const householdId = randomUUID(), sharedId = randomUUID(), privateId = randomUUID();
const people = new Map<Role, { id: string; headers: Record<string, string> }>();
const tag = randomUUID().replaceAll("-", "").slice(0, 12);
const password = "SyntheticA47Worth123!";
const now = new Date();
const today = now.toISOString().slice(0, 10);
// The earlier capture must be in a different month for the changes endpoint.
const earlier = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
const range = { from: earlier, to: today };
const zmw = (amount: string) => ({ amount, currency: "ZMW" });
let app: Awaited<ReturnType<typeof getTestApp>>;

async function netWorth(role: Role) {
  await analyticsCache.invalidateHousehold(householdId);
  return (await request(app).get("/api/reports/net-worth").set(people.get(role)!.headers).query(range).expect(200)).body;
}

async function netWorthChanges(role: Role) {
  return (await request(app).get("/api/reports/net-worth/changes").set(people.get(role)!.headers).query(range).expect(200)).body;
}
const breakdown = (body: { data: { breakdown?: { assetsByType: Array<{ type: string; value: unknown }> } } }) =>
  body.data.breakdown?.assetsByType ?? [];
const netWorthLine = (body: { data: { series: Array<{ id: string; data: unknown[] }> } }) =>
  body.data.series.find((line) => line.id === "Net Worth")!.data;

/** Every money amount the response carries, wherever it sits. */
function amounts(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(amounts);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const own = typeof record.amount === "string" && typeof record.currency === "string" ? [record.amount] : [];
  return [...own, ...Object.values(record).flatMap(amounts)];
}
/** The hidden amount is neither returned nor the difference of any two returned figures. */
function expectNotDerivable(body: unknown, hidden: string) {
  const seen = Array.from(new Set(amounts(body)));
  expect(seen.length).toBeGreaterThan(0);
  for (const a of seen) {
    expect(new Decimal(a).abs().eq(hidden), `returned ${a}`).toBe(false);
    for (const b of seen) expect(new Decimal(a).minus(b).abs().eq(hidden), `${a} - ${b}`).toBe(false);
  }
}

describe("A-47 net-worth history and breakdown follow current account visibility", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30 }));
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic A-47 history', 'ZMW')", [householdId]);
    const passwordHash = await hashPassword(password);
    for (const role of ["owner", "admin", "member"] as const) {
      const id = randomUUID(), email = `a47-${role}-${tag}@example.invalid`;
      await db.insert(users).values({ id, email, username: `a47-${role}-${tag}`, passwordHash, emailVerified: true });
      await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, $3)", [householdId, id, role]);
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      people.set(role, { id, headers: { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "),
        "X-Capital-Subject": id, "X-Capital-Household": householdId } });
    }
    // A shared K100 checking account (the owner's) and the admin's private K777 savings.
    await db.insert(accounts).values([
      { id: sharedId, householdId, ownerUserId: people.get("owner")!.id, name: "A47 shared checking", type: "checking",
        currency: "ZMW", isAsset: true, isPrivate: false, initialBalance: "100.00", balance: "100.00" },
      { id: privateId, householdId, ownerUserId: people.get("admin")!.id, name: "A47 private savings", type: "savings",
        currency: "ZMW", isAsset: true, isPrivate: true, initialBalance: "777.00", balance: "777.00" },
    ]);
    // The daily worker stores the household's capture, private savings included,
    // and an earlier capture of the same accounts sits in the prior month.
    expect(await snapshotWorker.processHousehold(householdId)).toBe(true);
    const [captured] = await db.select().from(netWorthSnapshots).where(eq(netWorthSnapshots.householdId, householdId));
    expect(captured).toMatchObject({ netWorth: "877.00", assetsByType: { checking: "100.00", savings: "777.00" } });
    const { id: _id, createdAt: _createdAt, ...copy } = captured;
    await db.insert(netWorthSnapshots).values({ ...copy, date: earlier,
      provenance: { ...(captured.provenance as Record<string, unknown>), captureId: randomUUID(), date: earlier } });
  }, 60_000);

  afterAll(async () => {
    for (const table of ["net_worth_snapshots", "audit_logs", "outbox_events"]) {
      await pool.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId]);
    }
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await pool.query("DELETE FROM household_members WHERE household_id = $1", [householdId]);
    await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
    const ids = Array.from(people.values(), ({ id }) => id);
    for (const id of ids) await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [id]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = ANY($1::uuid[])", [ids]);
    if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  });

  it("an owner peer sees only the shared K100 in the stored history and breakdown", async () => {
    const body = await netWorth("owner");
    expect(body.data.historyCoverage).toBe("snapshots");
    expect(body.data.latest).toMatchObject({ date: today, netWorth: zmw("100.00"), assets: zmw("100.00"), liabilities: zmw("0.00") });
    expect(netWorthLine(body)).toEqual([{ x: earlier, y: zmw("100.00") }, { x: today, y: zmw("100.00") }]);
    expect(breakdown(body)).toEqual([{ type: "checking", value: zmw("100.00") }]);
    // Nothing in the response carries the private amount, the household total,
    // or two figures that differ by the private amount.
    expect(JSON.stringify(body)).not.toMatch(/"(777|877)\.00"/);
    expectNotDerivable(body, "777.00");
  });

  it("the private account's owner sees their own savings in the same history", async () => {
    const body = await netWorth("admin");
    expect(body.data.historyCoverage).toBe("snapshots");
    expect(body.data.latest).toMatchObject({ netWorth: zmw("877.00"), assets: zmw("877.00") });
    expect(netWorthLine(body)).toEqual([{ x: earlier, y: zmw("877.00") }, { x: today, y: zmw("877.00") }]);
    expect(breakdown(body)).toEqual(expect.arrayContaining([
      { type: "checking", value: zmw("100.00") }, { type: "savings", value: zmw("777.00") },
    ]));
    expect(breakdown(body)).toHaveLength(2);
  });

  it("a member peer's own-scope report never carries the private savings", async () => {
    const body = await netWorth("member");
    expect(JSON.stringify(body)).not.toMatch(/"(777|877)\.00"/);
    expectNotDerivable(body, "777.00");
  });

  it("after a later privacy change, the earlier history follows today's visibility", async () => {
    const before = await netWorthChanges("admin");
    expect(before.data.periods).toEqual([expect.objectContaining({ startNetWorth: zmw("877.00"), endNetWorth: zmw("877.00") })]);

    // The owner makes the shared checking private after both captures.
    await db.update(accounts).set({ isPrivate: true }).where(eq(accounts.id, sharedId));
    try {
      const changes = await netWorthChanges("admin");
      expect(changes.data.periods).toEqual([expect.objectContaining({ startNetWorth: zmw("777.00"), endNetWorth: zmw("777.00") })]);
      expectNotDerivable(changes, "100.00");

      const admin = await netWorth("admin");
      expect(admin.data.latest).toMatchObject({ netWorth: zmw("777.00") });
      expect(netWorthLine(admin)).toEqual([{ x: earlier, y: zmw("777.00") }, { x: today, y: zmw("777.00") }]);
      expect(breakdown(admin)).toEqual([{ type: "savings", value: zmw("777.00") }]);
      expect(JSON.stringify(admin)).not.toMatch(/"(877|100)\.00"/);
      expectNotDerivable(admin, "100.00");

      const owner = await netWorth("owner");
      expect(owner.data.latest).toMatchObject({ netWorth: zmw("100.00") });
      expect(netWorthLine(owner)).toEqual([{ x: earlier, y: zmw("100.00") }, { x: today, y: zmw("100.00") }]);
      expect(breakdown(owner)).toEqual([{ type: "checking", value: zmw("100.00") }]);
      expect(JSON.stringify(owner)).not.toMatch(/"(777|877)\.00"/);
      expectNotDerivable(owner, "777.00");
    } finally {
      await db.update(accounts).set({ isPrivate: false }).where(eq(accounts.id, sharedId));
    }
  });

  it("a peer's soft-deleted private account still counts as hidden in the stored history", async () => {
    await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, privateId));
    try {
      const owner = await netWorth("owner");
      expect(JSON.stringify(owner)).not.toMatch(/"(777|877)\.00"/);
      expectNotDerivable(owner, "777.00");
    } finally {
      await db.update(accounts).set({ deletedAt: null }).where(eq(accounts.id, privateId));
    }
  });
});
