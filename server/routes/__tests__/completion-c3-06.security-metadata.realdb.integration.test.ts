import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, or } from "drizzle-orm";
import request from "supertest";
import { auditLogs, householdMembers, securities, securityPrices, users, userSessions } from "@shared/schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";
import { investmentService } from "../../modules/investments/investments.service";
import {
  cleanPriceFixture,
  createPriceFixture,
  globalPriceState,
  metadata,
  password,
  seedPriceFixture,
  setOtherRole,
  signed,
  type PriceFixture,
} from "./completion-c3-06.price-confirmation.fixture";

let app: Awaited<ReturnType<typeof getTestApp>>;
let fixture: PriceFixture;
let passwordHash: string;
const path = "/api/investments/securities";

function readActorAudits() {
  return db.select().from(auditLogs).where(or(
    eq(auditLogs.householdId, fixture.otherHouseholdId),
    eq(auditLogs.userId, fixture.other.id),
  )).orderBy(auditLogs.id);
}

describe("C3-06 security creation accepts metadata without a global price", () => {
  beforeAll(async () => {
    app = await getTestApp();
    passwordHash = await hashPassword(password);
  });

  beforeEach(async () => {
    fixture = createPriceFixture();
    await seedPriceFixture(fixture, app, passwordHash);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (fixture) await cleanPriceFixture(fixture);
  });

  it.each(["member", "admin", "owner"] as const)(
    "returns 400 without price or audit writes when a %s supplies currentPrice",
    async role => {
      await setOtherRole(fixture, role);
      const fields = metadata(fixture);
      const before = await globalPriceState(fixture);
      const response = await signed(app, fixture, "other", "post", path)
        .send({ ...fields, currentPrice: "1.00" })
        .expect(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(await globalPriceState(fixture)).toEqual(before);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.householdId, fixture.otherHouseholdId))).toEqual([]);
    },
  );

  it.each(["member", "admin", "owner"] as const)(
    "retains a %s's metadata-only creation and its legitimate optional fields",
    async role => {
      await setOtherRole(fixture, role);
      const fields = { ...metadata(fixture), exchange: "luse", sector: "Synthetic sector",
        isOffshore: true, cusipIsin: "SYNTHETIC-C306", withholdingTaxRate: "0.00" };
      const response = await signed(app, fixture, "other", "post", path)
        .send(fields)
        .expect(201);
      const [stored] = await db.select().from(securities).where(eq(securities.id, response.body.data.id));
      expect(stored).toMatchObject({ ...fields, currentPrice: null, lastPriceUpdate: null });
      expect(await db.select().from(securityPrices).where(eq(securityPrices.securityId, stored.id))).toEqual([]);
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, stored.id));
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        householdId: fixture.otherHouseholdId,
        userId: fixture.other.id,
        entityType: "security",
        action: "CREATE",
        details: {
          newValue: { symbol: fields.symbol, name: fields.name, type: fields.type, currency: fields.currency },
        },
      });
    },
  );

  it("rolls back signed metadata creation when its required CREATE audit fails", async () => {
    const fields = metadata(fixture);
    const submit = () => signed(app, fixture, "other", "post", path)
      .set("X-Forwarded-For", "203.0.113.10, 10.0.0.1")
      .send(fields);
    const before = await globalPriceState(fixture);
    const priorAudits = await readActorAudits();
    const fault = `c306_create_audit_${fixture.other.id.replaceAll("-", "")}`;
    try {
      await pool.query(`
        CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.user_id = '${fixture.other.id}'::uuid
            AND NEW.household_id = '${fixture.otherHouseholdId}'::uuid
            AND NEW.entity_type = 'security' AND NEW.action = 'CREATE' THEN
            RAISE EXCEPTION 'Synthetic mandatory security creation audit failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER ${fault} BEFORE INSERT ON audit_logs
          FOR EACH ROW EXECUTE FUNCTION ${fault}()
      `);
      const rejected = await submit();
      expect.soft(rejected.status).toBe(500);
      expect.soft(rejected.body).toMatchObject({ success: false, error: { code: "INTERNAL_ERROR" } });
      expect.soft(await globalPriceState(fixture)).toEqual(before);
      expect.soft(await readActorAudits()).toEqual(priorAudits);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fault} ON audit_logs; DROP FUNCTION IF EXISTS ${fault}()`);
    }

    const accepted = await submit().expect(201);
    const id = accepted.body.data.id;
    const after = await globalPriceState(fixture);
    const priorIds = new Set(before.instruments.map(row => row.id));
    expect(after.instruments.filter(row => !priorIds.has(row.id)))
      .toMatchObject([{ id, ...fields, currentPrice: null, lastPriceUpdate: null }]);
    expect(after.prices).toEqual(before.prices);
    const priorAuditIds = new Set(priorAudits.map(row => row.id));
    expect((await readActorAudits()).filter(row => !priorAuditIds.has(row.id))).toMatchObject([{
      householdId: fixture.otherHouseholdId, userId: fixture.other.id, entityId: id,
      entityType: "security", action: "CREATE",
    }]);
  });

  it("rejects a signed creation when that selected device is revoked after route admission", async () => {
    const fields = metadata(fixture);
    const [tracked] = await db.select().from(userSessions).where(eq(userSessions.userId, fixture.other.id));
    expect(tracked).toBeDefined();
    const [credential] = await db.select({ generation: users.securityGeneration }).from(users).where(eq(users.id, fixture.other.id));
    const secondLogin = await request(app).post("/api/auth/login").send({ email: fixture.other.email, password }).expect(200);
    const secondCookie = (secondLogin.headers["set-cookie"] as unknown as string[]).join("; ");
    await request(app).post("/api/settings/security/step-up").set("Cookie", secondCookie).send({ password }).expect(200);
    const before = await globalPriceState(fixture);
    const beforeSecurityAudits = (await readActorAudits()).filter(row => row.entityType === "security");

    const original = investmentService.createSecurity.bind(investmentService);
    const admission = vi.spyOn(investmentService, "createSecurity").mockImplementationOnce(async (...args) => {
      // The production signed handler already admitted the member. Complete
      // selected-device revocation from a second real signed device first.
      expect(args[1]).toMatchObject({ householdId: fixture.otherHouseholdId, userId: fixture.other.id, role: "member" });
      await request(app).delete(`/api/settings/security/sessions/${tracked.id}`).set("Cookie", secondCookie).expect(200);
      return original(...args);
    });

    const response = await signed(app, fixture, "other", "post", path).send(fields);
    expect(admission).toHaveBeenCalledOnce();
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(await db.select().from(userSessions).where(eq(userSessions.id, tracked.id))).toEqual([]);
    expect(await db.select({ generation: users.securityGeneration }).from(users).where(eq(users.id, fixture.other.id))).toEqual([credential]);
    expect(await globalPriceState(fixture)).toEqual(before);
    expect((await readActorAudits()).filter(row => row.entityType === "security")).toEqual(beforeSecurityAudits);
    await request(app).get("/api/auth/me").set("Cookie", secondCookie).expect(200);
  });

  it("rejects a signed creation when its member grant changes after route admission", async () => {
    const fields = metadata(fixture);
    const before = await globalPriceState(fixture);
    const beforeAudits = await readActorAudits();
    const original = investmentService.createSecurity.bind(investmentService);
    const admission = vi.spyOn(investmentService, "createSecurity").mockImplementationOnce(async (...args) => {
      expect(args[1].role).toBe("member");
      await db.update(householdMembers).set({ role: "view_only" }).where(eq(householdMembers.userId, fixture.other.id));
      return original(...args);
    });

    await signed(app, fixture, "other", "post", path).send(fields).expect(403);
    expect(admission).toHaveBeenCalledOnce();
    expect(await globalPriceState(fixture)).toEqual(before);
    expect(await readActorAudits()).toEqual(beforeAudits);
  });

  it("rejects a legacy direct service price input before inserting a security", async () => {
    const input = { ...metadata(fixture), currentPrice: "1.00" };
    const before = await globalPriceState(fixture);
    // @ts-expect-error An old JavaScript caller supplies a price and omits the audit actor.
    await expect(investmentService.createSecurity(input)).rejects.toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
    expect(await globalPriceState(fixture)).toEqual(before);
  });

  it.each(["view_only", "professional"] as const)(
    "retains 403 for a %s with or without a supplied price",
    async role => {
      await db.update(householdMembers).set({ role }).where(eq(householdMembers.userId, fixture.other.id));
      const fields = metadata(fixture);
      const before = await globalPriceState(fixture);
      for (const body of [fields, { ...fields, currentPrice: "1.00" }]) {
        await signed(app, fixture, "other", "post", path).send(body).expect(403);
      }
      expect(await globalPriceState(fixture)).toEqual(before);
    },
  );
});
