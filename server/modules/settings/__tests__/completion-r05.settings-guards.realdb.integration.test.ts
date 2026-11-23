import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import {
  accounts, auditLogs, householdMembers, householdPreferences, households, transactions, users,
} from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";

// R05 settings guards, real Postgres over real HTTP with signed sessions.
// SET-05: the base currency is refused with 409 LEDGER_NOT_EMPTY once the
// household has a transaction, and the row is left exactly as it was.
// NEW-16: household_preferences.auto_rollover_budget is written only by owners
// and admins, audited in the same transaction, and read back by GET.
const roles = ["owner", "admin", "member", "view_only", "professional"] as const;
type Role = (typeof roles)[number];
const WRITERS: readonly Role[] = ["owner", "admin"];
const BASE = "ZMW";
const password = "SyntheticR05Guards123!";
const householdId = randomUUID();
const actors = new Map<Role, { id: string; cookie: string }>();
let app: Awaited<ReturnType<typeof getTestApp>>;

const cookie = (role: Role) => actors.get(role)!.cookie;
const putGeneral = (role: Role, body: Record<string, unknown>) =>
  request(app).put("/api/household/general").set("Cookie", cookie(role)).send(body);
const putPreferences = (role: Role, body: Record<string, unknown>) =>
  request(app).put("/api/settings/preferences").set("Cookie", cookie(role)).send(body);

async function snapshot() {
  return {
    household: await db.select().from(households).where(eq(households.id, householdId)),
    preferences: await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId)),
    audit: await db.select().from(auditLogs)
      .where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityType, "household_preferences"))),
  };
}

async function recordTransaction() {
  const accountId = randomUUID();
  await db.insert(accounts).values({
    id: accountId, householdId, name: "R05 checking", type: "checking", currency: BASE,
    initialBalance: "0.00", balance: "0.00", ownerUserId: actors.get("owner")!.id,
  });
  await db.insert(transactions).values({
    householdId, accountId, ownerUserId: actors.get("owner")!.id, date: "2026-11-01",
    name: "R05 first purchase", amount: "12.50", type: "expense", currency: BASE,
  });
}

describe("R05 settings guards with actual signed sessions", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic R05 guards", currency: BASE });
    const passwordHash = await hashPassword(password);
    for (const role of roles) {
      const id = randomUUID();
      const email = `r05-${id}@example.invalid`;
      await db.insert(users).values({ id, email, username: `r05-${id}`, passwordHash, emailVerified: true });
      await db.insert(householdMembers).values({ householdId, userId: id, role });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors.set(role, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
    }
  }, 30_000);

  beforeEach(async () => {
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.update(households).set({ name: "Synthetic R05 guards", currency: BASE })
      .where(eq(households.id, householdId));
  });

  afterAll(async () => {
    await db.delete(transactions).where(eq(transactions.householdId, householdId));
    await db.delete(accounts).where(eq(accounts.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const { id } of actors.values()) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  describe("SET-05 base currency", () => {
    it("changes the currency of a household with no transactions, audited", async () => {
      const response = await putGeneral("owner", { currency: "USD" }).expect(200);
      expect(response.body.data.household.currency).toBe("USD");
      const after = await snapshot();
      expect(after.household[0].currency).toBe("USD");
      expect(after.audit).toHaveLength(1);
      expect(after.audit[0]).toMatchObject({ userId: actors.get("owner")!.id, action: "UPDATE", entityId: householdId });
      expect(after.audit[0].details).toMatchObject({ oldValue: { currency: BASE }, newValue: { currency: "USD" } });
    });

    it("refuses a currency change once a transaction exists and leaves the row unchanged", async () => {
      await recordTransaction();
      const before = await snapshot();
      const response = await putGeneral("owner", { name: "Renamed with currency", currency: "USD" }).expect(409);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("LEDGER_NOT_EMPTY");
      expect(response.body.error.message).toContain("can't be changed after transactions have been recorded");
      expect(await snapshot()).toEqual(before);
    });

    it("still renames a household with transactions when the currency is resubmitted unchanged", async () => {
      await recordTransaction();
      const response = await putGeneral("admin", { name: "Renamed R05", currency: BASE }).expect(200);
      expect(response.body.data.household).toMatchObject({ name: "Renamed R05", currency: BASE });
      const after = await snapshot();
      expect(after.household[0]).toMatchObject({ name: "Renamed R05", currency: BASE });
      expect(after.audit).toHaveLength(1);
    });
  });

  describe("NEW-16 auto rollover budget", () => {
    it.each(roles)("PUT autoRolloverBudget by %s has the capability outcome", async (role) => {
      const before = await snapshot();
      const response = await putPreferences(role, { autoRolloverBudget: true });
      if (!WRITERS.includes(role)) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("FORBIDDEN");
        expect(await snapshot()).toEqual(before);
        return;
      }
      expect(response.status).toBe(200);
      const after = await snapshot();
      expect(after.preferences).toHaveLength(1);
      expect(after.preferences[0].autoRolloverBudget).toBe(true);
      expect(after.audit).toHaveLength(1);
      expect(after.audit[0]).toMatchObject({ userId: actors.get(role)!.id, action: "UPDATE", entityId: householdId });
      const readback = await request(app).get("/api/settings/preferences").set("Cookie", cookie("view_only")).expect(200);
      expect(readback.body.data.preferences.autoRolloverBudget).toBe(true);
    });

    it("turns rollover back off and reads false", async () => {
      await putPreferences("owner", { autoRolloverBudget: true }).expect(200);
      await putPreferences("owner", { autoRolloverBudget: false }).expect(200);
      const readback = await request(app).get("/api/settings/preferences").set("Cookie", cookie("member")).expect(200);
      expect(readback.body.data.preferences.autoRolloverBudget).toBe(false);
    });

    it("rejects a non-boolean autoRolloverBudget without writing", async () => {
      const before = await snapshot();
      await putPreferences("owner", { autoRolloverBudget: "yes" }).expect(400);
      expect(await snapshot()).toEqual(before);
    });
  });
});
