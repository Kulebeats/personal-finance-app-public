import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { auditLogs, householdMembers, householdPreferences, households, users } from "@shared/schema";
import { hashPassword } from "../../../auth";
import { getTestApp } from "../../../__tests__/fixtures";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { businessAuditService } from "../../../services/BusinessAuditService";
import * as ownershipService from "../../household/ownership.service";

const roles = ["owner", "admin", "member", "view_only", "professional"] as const;
type Role = (typeof roles)[number];
const password = "SyntheticR04Password123!";
const householdId = randomUUID();
const actors = new Map<Role, { id: string; cookie: string }>();
let app: Awaited<ReturnType<typeof getTestApp>>;
const memberWhere = (id: string) => and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, id));
const put = (role: Role) => request(app).put("/api/settings/preferences").set("Cookie", actors.get(role)!.cookie)
  .send({ showPendingTransactions: false, allowEditPending: false });
async function snapshot() {
  return {
    preferences: await db.select().from(householdPreferences).where(eq(householdPreferences.householdId, householdId)),
    audit: await db.select().from(auditLogs).where(and(eq(auditLogs.householdId, householdId), eq(auditLogs.entityType, "household_preferences"))),
  };
}
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("R04 household policy boundary with actual signed sessions", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic R04 policy" });
    const passwordHash = await hashPassword(password);
    for (const role of roles) {
      const id = randomUUID(), email = `r04-${id}@example.invalid`;
      await db.insert(users).values({ id, email, username: `r04-${id}`, passwordHash, emailVerified: true });
      await db.insert(householdMembers).values({ householdId, userId: id, role });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors.set(role, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
    }
  }, 20000);
  beforeEach(async () => {
    await db.delete(householdPreferences).where(eq(householdPreferences.householdId, householdId));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    for (const role of roles) {
      const userId = actors.get(role)!.id;
      await db.insert(householdMembers).values({ householdId, userId, role })
        .onConflictDoUpdate({ target: [householdMembers.householdId, householdMembers.userId], set: { role } });
    }
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const { id } of actors.values()) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it.each(roles)("GET by %s represents missing policy as null without creating it", async (role) => {
    const before = await snapshot();
    const response = await request(app).get("/api/settings/preferences").set("Cookie", actors.get(role)!.cookie).expect(200);
    expect(response.body.data.preferences).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  describe.each([false, true])("existing policy=%s", (existing) => {
    beforeEach(async () => {
      if (existing) await db.insert(householdPreferences).values({ householdId });
    });
    it.each(roles)("PUT by %s has exact capability and persistence outcome", async (role) => {
      const before = await snapshot();
      const response = await put(role);
      if (role === "owner" || role === "admin") {
        expect(response.status).toBe(200);
        const after = await snapshot();
        expect(after.preferences).toHaveLength(1);
        expect(after.preferences[0]).toMatchObject({ householdId, showPendingTransactions: false, allowEditPending: false });
        expect(after.audit).toHaveLength(1);
        expect(after.audit[0]).toMatchObject({ userId: actors.get(role)!.id, action: "UPDATE", entityId: householdId });
        expect(after.audit[0].details).toMatchObject({ oldValue: before.preferences[0] ? JSON.parse(JSON.stringify(before.preferences[0])) : null });
        const readback = await request(app).get("/api/settings/preferences").set("Cookie", actors.get("professional")!.cookie).expect(200);
        expect(readback.body.data.preferences.showPendingTransactions).toBe(false);
      } else {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("FORBIDDEN");
        expect(await snapshot()).toEqual(before);
      }
    });
  });

  describe.each([false, true])("request contract; existing policy=%s", (existing) => {
    beforeEach(async () => {
      if (existing) await db.insert(householdPreferences).values({ householdId });
    });
    it.each([
      ["empty", {}],
      ["theme only", { theme: "dark" }],
      ["date format only", { dateFormat: "DD/MM/YYYY" }],
      ["currency only", { currency: "USD" }],
      ["week start only", { weekStartDay: 1 }],
      ["notification flag only", { notificationsEnabled: false }],
      ["mixed display and policy", { theme: "dark", showPendingTransactions: false }],
      ["mixed unknown and policy", { rememberLastAccount: true, allowEditPending: false }],
    ])("owner rejects %s without writing policy or audit", async (_label, body) => {
      const before = await snapshot();
      const response = await request(app).put("/api/settings/preferences")
        .set("Cookie", actors.get("owner")!.cookie).send(body);
      const after = await snapshot();
      expect.soft(response.status).toBe(400);
      expect(after).toEqual(before);
    });

    it.each(["member", "view_only", "professional"] as const)("denied %s gets capability403 before bad-payload validation", async (role) => {
      const before = await snapshot();
      for (const body of [{}, { theme: "dark" }, { theme: "dark", allowEditPending: false }]) {
        const response = await request(app).put("/api/settings/preferences")
          .set("Cookie", actors.get(role)!.cookie).send(body).expect(403);
        expect(response.body.error.code).toBe("FORBIDDEN");
        expect(await snapshot()).toEqual(before);
      }
    });

    it.each(["showPendingTransactions", "allowEditPending"] as const)("owner saves a single false %s and preserves its omitted peer", async (field) => {
      const before = await snapshot();
      const response = await request(app).put("/api/settings/preferences")
        .set("Cookie", actors.get("owner")!.cookie).send({ [field]: false }).expect(200);
      const after = await snapshot();
      const peer = field === "showPendingTransactions" ? "allowEditPending" : "showPendingTransactions";
      expect(response.body.data.preferences[field]).toBe(false);
      expect(after.preferences[0][field]).toBe(false);
      expect(after.preferences[0][peer]).toBe(existing ? before.preferences[0][peer] : true);
      expect(after.audit).toHaveLength(1);
    });
  });

  it("rejects an unknown stored role at the repository seam before any create or audit", async () => {
    const actor = actors.get("admin")!;
    const original = householdRepository.findMember.bind(householdRepository);
    vi.spyOn(householdRepository, "findMember").mockImplementation(async (...args) => {
      const row = await original(...args);
      return args[1] === actor.id ? { ...row, role: "operator" } as never : row;
    });
    const before = await snapshot();
    await put("admin").expect(403);
    await request(app).get("/api/settings/preferences").set("Cookie", actor.cookie).expect(403);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["downgrade", "remove"] as const)("rechecks %s after middleware captured admin", async (mode) => {
    const actor = actors.get("admin")!, entered = signal(), gate = signal();
    const original = householdRepository.findMember.bind(householdRepository);
    vi.spyOn(householdRepository, "findMember").mockImplementationOnce(async (...args) => {
      const row = await original(...args);
      expect(row.role).toBe("admin");
      entered.resolve(); await gate.promise; return row;
    });
    const before = await snapshot();
    const pending = put("admin").then((response) => response);
    try {
      await entered.promise;
      const byOwner = { householdId, actorUserId: actors.get("owner")!.id };
      if (mode === "downgrade") await ownershipService.changeMemberRole(byOwner, actor.id, "view_only");
      else await ownershipService.removeMember(byOwner, actor.id);
    } finally { gate.resolve(); }
    expect((await pending).status).toBe(403);
    expect(await snapshot()).toEqual(before);
    await put("admin").expect(mode === "remove" ? 404 : 403);
  });

  it.each([false, true])("rolls policy back when its same-transaction audit fails; existing=%s", async (existing) => {
    if (existing) await db.insert(householdPreferences).values({ householdId });
    const before = await snapshot();
    const original = businessAuditService.logUpdate.bind(businessAuditService);
    vi.spyOn(businessAuditService, "logUpdate").mockImplementationOnce(async (entry) => {
      expect(entry.tx).toBeDefined();
      await original(entry);
      throw new Error("Synthetic R04 audit rollback");
    });
    await put("owner").expect(500);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["downgrade", "remove"] as const)("waits for an in-flight %s and denies after its commit", async (mode) => {
    const actor = actors.get("admin")!, locking = signal();
    const holder = await pool.connect();
    let holderPid = 0, writerPid = 0, completed = false, pending: Promise<request.Response> | undefined;
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof original>) {
      const result: unknown = Reflect.apply(original, this, args);
      const [query] = args as unknown as [unknown];
      const text = typeof query === "object" && query !== null && "text" in query ? query.text : query;
      if (typeof text === "string" && /from "household_members"/i.test(text) && /for update/i.test(text)) {
        writerPid = Reflect.get(this, "processID") as number; locking.resolve();
      }
      return result as ReturnType<typeof original>;
    });
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Role-first lock barrier not reached")), 8000); });
    const before = await snapshot();
    try {
      holderPid = (await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await holder.query("BEGIN");
      if (mode === "downgrade") await holder.query("UPDATE household_members SET role = 'view_only' WHERE household_id = $1 AND user_id = $2", [householdId, actor.id]);
      else await holder.query("DELETE FROM household_members WHERE household_id = $1 AND user_id = $2", [householdId, actor.id]);
      pending = put("admin").then((response) => { completed = true; return response; });
      await Promise.race([locking.promise, deadline]);
      while (true) {
        const { rows: [lock] } = await Promise.race([
          pool.query<{ blocked: boolean }>("SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked", [holderPid, writerPid]), deadline,
        ]);
        if (lock.blocked) break;
      }
      expect(completed).toBe(false);
      await holder.query("COMMIT");
      expect((await pending).status).toBe(403);
    } finally {
      clearTimeout(timer); spy.mockRestore(); await holder.query("ROLLBACK"); holder.release();
      await Promise.allSettled(pending ? [pending] : []);
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each(["view_only", "professional"] as const)("%s retains own display and security operations", async (role) => {
    const actor = actors.get(role)!;
    await request(app).put("/api/settings/display").set("Cookie", actor.cookie).send({ theme: "dark" }).expect(200);
    const display = await request(app).get("/api/settings/display").set("Cookie", actor.cookie).expect(200);
    expect(display.body.data.settings.theme).toBe("dark");
    await request(app).post("/api/settings/security/step-up").set("Cookie", actor.cookie).send({ password }).expect(200);
    const sessions = await request(app).get("/api/settings/security/sessions").set("Cookie", actor.cookie).expect(200);
    expect(sessions.body.data.sessions.length).toBeGreaterThan(0);
    expect((await snapshot()).preferences).toHaveLength(0);
  });

  it.each(["view_only", "professional"] as const)("%s can use inputs-only calculators without writing policy", async (role) => {
    const cookie = actors.get(role)!.cookie, before = await snapshot(), debtId = randomUUID();
    const cases = [
      ["/api/goals/debt-strategy", { method: "snowball", debts: [{ id: debtId, balance: 100, rate: 0, minPayment: 10 }] }, [{ debtId, payoffOrder: 1 }]],
      ["/api/goals/calculate-projection", { currentAmount: 100, monthlyContribution: 0, returnRate: 0, years: 1 }, { projectedAmount: 100, totalContributed: 100 }],
      ["/api/investments/grz/calculate/bond-price", { faceValue: 100, couponRate: 0, yearsToMaturity: 1, requiredYield: 0 }, { cleanPrice: 100, dirtyPrice: 100 }],
      ["/api/investments/grz/calculate/bond-price", { method: "clean_quote", faceValue: "1000", pricePer100: "97", accruedPer100: "2.51" }, { cleanPrice: "970.00", accruedInterest: "25.10", dirtyPrice: "995.10" }],
      ["/api/investments/grz/calculate/bond-price", { method: "dirty_quote", faceValue: "1000", pricePer100: "99.51" }, { cleanPrice: null, accruedInterest: null, dirtyPrice: "995.10" }],
      ["/api/investments/grz/calculate/ytm", { faceValue: 100, couponRate: 0, yearsToMaturity: 1, currentPrice: 100 }, { ytm: 0 }],
      ["/api/investments/grz/calculate/accrued", { faceValue: 100, couponRate: 0, lastCouponDate: "2026-01-01", settlementDate: "2026-01-31" }, { accruedInterest: 0, daysAccrued: 30 }],
      ["/api/investments/grz/calculate/tbill-yield", { faceValue: 100, discountRate: 0, tenorDays: 90 }, { purchasePrice: 100, grossReturn: 0 }],
    ] as const;
    for (const [path, body, result] of cases) {
      const response = await request(app).post(path).set("Cookie", cookie).send(body);
      expect(response.status, path).toBe(200);
      expect(response.body.success, path).toBe(true);
      expect(response.body.data, path).toMatchObject(result);
    }
    await request(app).post("/api/investments/grz/calculate/bond-price").set("Cookie", cookie)
      .send({ faceValue: 100, couponRate: 0, yearsToMaturity: 1, requiredYield: 0, pricePer100: "90" }).expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it("serializes an already locked policy write before a competing downgrade", async () => {
    const actor = actors.get("admin")!, written = signal(), gate = signal(), changing = signal();
    let writerPid = 0, changerPid = 0, completed = false;
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof original>) {
      const result: unknown = Reflect.apply(original, this, args);
      const [query] = args as unknown as [unknown];
      const text = typeof query === "object" && query !== null && "text" in query ? query.text : query;
      if (typeof text === "string") {
        if (/^update "household_preferences"/i.test(text)) {
          writerPid = Reflect.get(this, "processID") as number;
          return Promise.resolve(result).then(async (value) => { written.resolve(); await gate.promise; return value; }) as unknown as ReturnType<typeof original>;
        }
        // The role change locks the household row first (NEW-12), so that is the query that waits.
        if (writerPid && /from "households"/i.test(text) && /for update/i.test(text)) {
          changerPid = Reflect.get(this, "processID") as number; changing.resolve();
        }
      }
      return result as ReturnType<typeof original>;
    });
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Policy lock barrier not reached")), 8000); });
    const pending = put("admin").then((response) => response);
    let downgrade: ReturnType<typeof ownershipService.changeMemberRole> | undefined;
    try {
      await Promise.race([written.promise, deadline]);
      downgrade = ownershipService.changeMemberRole({ householdId, actorUserId: actors.get("owner")!.id }, actor.id, "view_only").then((row) => { completed = true; return row; });
      await Promise.race([changing.promise, deadline]);
      while (true) {
        const { rows: [lock] } = await Promise.race([
          pool.query<{ blocked: boolean }>("SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked", [writerPid, changerPid]), deadline,
        ]);
        if (lock.blocked) break;
      }
      expect(completed).toBe(false);
      gate.resolve();
      expect((await pending).status).toBe(200);
      expect((await downgrade).role).toBe("view_only");
    } finally {
      clearTimeout(timer); gate.resolve(); spy.mockRestore();
      await Promise.allSettled([pending, ...(downgrade ? [downgrade] : [])]);
    }
    expect((await snapshot()).audit).toHaveLength(1);
    const committed = await snapshot();
    await put("admin").expect(403);
    expect(await snapshot()).toEqual(committed);
  });
});
