/**
 * NEW-39 (admin part): GET /api/admin/calculation-shadow-status queried a
 * calculation_logs table that exists in neither shared/schema.ts nor the
 * migrations, and read its latency with parseFloat. Nothing in the client or
 * server called it, so the handler is removed. A system-role admin now gets
 * 404 for it, while the rest of the admin router still answers behind its
 * unchanged auth and system-role gate. Real HTTP against real Postgres.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { householdMembers, households, systemRoles, userSystemRoles, users } from "@shared/schema";
import { db, pool } from "../../db";
import { hashPassword } from "../../auth";
import { getTestApp } from "../../__tests__/fixtures";

const password = "SyntheticAdminRoute123!";
const PATH = "/api/admin/calculation-shadow-status";
const householdId = randomUUID();
const actors = new Map<"admin" | "plain", { id: string; cookie: string }>();
let app: Awaited<ReturnType<typeof getTestApp>>;

describe("NEW-39 the calculation shadow-status admin route is gone", () => {
  beforeAll(async () => {
    app = await getTestApp();
    await db.insert(households).values({ id: householdId, name: "Synthetic admin route household" });
    await db.insert(systemRoles).values({ name: "super_admin" }).onConflictDoNothing();
    const [{ id: superAdminId }] = await db.select({ id: systemRoles.id }).from(systemRoles).where(eq(systemRoles.name, "super_admin"));
    const passwordHash = await hashPassword(password);
    for (const name of ["admin", "plain"] as const) {
      const id = randomUUID();
      const email = `new39-admin-${id}@example.invalid`;
      await db.insert(users).values({ id, email, username: `new39-${name}-${id.slice(0, 8)}`, passwordHash, emailVerified: true });
      await db.insert(householdMembers).values({ householdId, userId: id, role: name === "admin" ? "owner" : "member" });
      if (name === "admin") await db.insert(userSystemRoles).values({ userId: id, roleId: superAdminId });
      const login = await request(app).post("/api/auth/login").send({ email, password }).expect(200);
      actors.set(name, { id, cookie: (login.headers["set-cookie"] as unknown as string[]).join("; ") });
    }
  }, 30_000);

  afterAll(async () => {
    const ids = [...actors.values()].map(({ id }) => id);
    await db.delete(userSystemRoles).where(inArray(userSystemRoles.userId, ids));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(households).where(eq(households.id, householdId));
    for (const id of ids) {
      await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [id]);
      await db.delete(users).where(eq(users.id, id));
    }
  });

  it("answers 404 to a system-role admin, while the admin router still serves its other routes", async () => {
    const cookie = actors.get("admin")!.cookie;
    await request(app).get("/api/admin/system-roles").set("Cookie", cookie).expect(200);
    const response = await request(app).get(PATH).set("Cookie", cookie);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toMatch(/last24Hours|recentMismatches|calculation_logs/);
  });

  it("keeps the admin gate: a user without a system role is refused before any route", async () => {
    await request(app).get(PATH).set("Cookie", actors.get("plain")!.cookie).expect(403);
    await request(app).get(PATH).expect(401);
  });
});
