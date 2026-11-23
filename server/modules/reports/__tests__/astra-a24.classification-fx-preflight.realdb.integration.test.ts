// A-24: the expense classification (and the expense breakdown it is built
// from) checks exchange rates only for rows the report itself includes. A
// foreign expense on a hidden account, or a foreign income, has no rate and
// is left out of the report, so it must not turn the report into a
// missing-rate 422. A foreign expense the report does include still fails
// closed. Real HTTP + Postgres.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../../../db";
import { accounts, fxRates, transactions, users } from "@shared/schema";
import { getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { createFXRateRepository, createFXRateService, setGlobalFXService } from "../../../core/calculations";
import { analyticsCache } from "../../../services/AnalyticsCache";

const householdId = randomUUID(), ownerId = randomUUID();
const localId = randomUUID(), hiddenForeignId = randomUUID(), visibleForeignId = randomUUID();
const tag = randomUUID().replaceAll("-", "").slice(0, 12), password = "SyntheticA24Rates123!";
const range = { from: "2026-03-01", to: "2026-03-31", scope: "household" };
let headers: Record<string, string> = {};
let app: Awaited<ReturnType<typeof getTestApp>>;

function row(accountId: string, type: "expense" | "income", currency: string, amount: string) {
  return { id: randomUUID(), householdId, accountId, type, currency, amount, date: "2026-03-10", name: `A24 ${tag}`, ownerUserId: ownerId };
}
async function get(path: string, query: Record<string, string>) {
  await analyticsCache.invalidateHousehold(householdId);
  return request(app).get(path).set(headers).query(query);
}

describe("A-24 classification and breakdown rate checks follow the rows the report includes", () => {
  beforeAll(async () => {
    app = await getTestApp();
    setGlobalFXService(createFXRateService(createFXRateRepository(db, fxRates), { cacheTtlSeconds: 300, baseCurrency: "ZMW", fallbackDays: 30 }));
    await db.insert(users).values({ id: ownerId, email: `a24-${tag}@example.invalid`, username: `a24-${tag}`,
      passwordHash: await hashPassword(password), emailVerified: true });
    await pool.query("INSERT INTO households (id, name, currency) VALUES ($1, 'Synthetic A-24 rates', 'ZMW')", [householdId]);
    await pool.query("INSERT INTO household_members (household_id, user_id, role) VALUES ($1, $2, 'owner')", [householdId, ownerId]);
    const account = (id: string, name: string, currency: string, hideTransactions = false): typeof accounts.$inferInsert => ({
      id, householdId, ownerUserId: ownerId, name, type: "checking", currency, isAsset: true, isPrivate: false,
      initialBalance: "0.00", balance: "0.00", hideTransactions,
    });
    await db.insert(accounts).values([
      account(localId, "A24 local", "ZMW"),
      // BWP has no rate into ZMW in this database.
      account(hiddenForeignId, "A24 hidden foreign", "BWP", true),
      account(visibleForeignId, "A24 visible foreign", "BWP"),
    ]);
    await db.insert(transactions).values([
      row(localId, "expense", "ZMW", "120.00"),
      // Left out of the report: an expense on a hidden account, and an income.
      row(hiddenForeignId, "expense", "BWP", "40.00"),
      row(visibleForeignId, "income", "BWP", "75.00"),
    ]);
    const login = await request(app).post("/api/auth/login").send({ email: `a24-${tag}@example.invalid`, password }).expect(200);
    headers = { Cookie: (login.headers["set-cookie"] as unknown as string[]).join("; "), "X-Capital-Subject": ownerId, "X-Capital-Household": householdId };
  }, 60_000);

  afterAll(async () => {
    await pool.query("DELETE FROM transactions WHERE household_id = $1", [householdId]);
    for (const table of ["accounts", "audit_logs", "outbox_events", "household_members"]) {
      await pool.query(`DELETE FROM ${table} WHERE household_id = $1`, [householdId]);
    }
    await pool.query("DELETE FROM households WHERE id = $1", [householdId]);
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\'=$1', [ownerId]);
    await pool.query("DELETE FROM security_audit_logs WHERE user_id = $1", [ownerId]);
    await db.delete(users).where(inArray(users.id, [ownerId]));
  });

  it("the classification is available when only excluded rows lack a rate", async () => {
    const response = await get("/api/reports/expenses/classification", range);
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/MISSING_FX_RATE|BWP/);
  });

  it("the expense breakdown is available when only a foreign income lacks a rate", async () => {
    const response = await get("/api/reports/spending/breakdown", { ...range, groupBy: "category", type: "expense" });
    expect(response.status).toBe(200);
  });

  it("a foreign expense the report includes still fails closed with a missing-rate 422", async () => {
    const included = row(visibleForeignId, "expense", "BWP", "15.00");
    await db.insert(transactions).values(included);
    try {
      const response = await get("/api/reports/expenses/classification", range);
      expect(response.status).toBe(422);
      expect(response.body.error).toMatchObject({ code: "MISSING_FX_RATE", details: { from: "BWP", to: "ZMW", date: "2026-03-10" } });
    } finally {
      await db.delete(transactions).where(eq(transactions.id, included.id));
    }
  });
});
