/**
 * #365 review P2: the remaining uuid path params answer 400 VALIDATION_ERROR at
 * the route boundary instead of reaching Postgres as an invalid uuid (500).
 * Filter presets, report exports, privacy export download, investment
 * recurring plans and occurrences, household invitations and the admin user
 * routes. `/api/filter-presets/default/:context` is not an id and keeps
 * working. Real HTTP against the real routers and real Postgres.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemRoles, userSystemRoles } from "@shared/schema";
import { db } from "../../db";
import { createSignedHousehold, type SignedHousehold } from "../../__tests__/signed-household-fixture";

type Verb = "get" | "post" | "put" | "patch" | "delete";
let fx: SignedHousehold;
const uuid = randomUUID();

function call(verb: Verb, path: string) {
  return request(fx.app)[verb](path).set(fx.headers).send({});
}

describe("#365 P2: malformed ids on the remaining uuid routes (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("p2-ids");
    // The admin routes sit behind a system role; grant it so the id check is what answers.
    await db.insert(systemRoles).values({ name: "super_admin" }).onConflictDoNothing();
    const [{ id: roleId }] = await db.select({ id: systemRoles.id }).from(systemRoles)
      .where(eq(systemRoles.name, "super_admin"));
    await db.insert(userSystemRoles).values({ userId: fx.userId, roleId });
  }, 30000);

  afterAll(async () => {
    if (fx) await fx.cleanup(async () => {
      await db.delete(userSystemRoles).where(eq(userSystemRoles.userId, fx.userId));
    });
  });

  const cases: ReadonlyArray<readonly [Verb, string]> = [
    ["get", "/api/filter-presets/not-a-uuid"],
    ["patch", "/api/filter-presets/not-a-uuid"],
    ["delete", "/api/filter-presets/not-a-uuid"],
    ["get", "/api/reports/exports/not-a-uuid"],
    ["get", "/api/settings/privacy/exports/not-a-uuid/download"],
    ["post", "/api/investments/recurring/not-a-uuid/authorize"],
    ["delete", "/api/investments/recurring/not-a-uuid"],
    ["get", "/api/investments/recurring/not-a-uuid/occurrences"],
    ["post", "/api/investments/recurring/not-a-uuid/occurrences/2026-01-01/confirm"],
    ["post", "/api/household/invitations/not-a-uuid/resend"],
    ["delete", "/api/household/invitations/not-a-uuid"],
    ["post", "/api/admin/users/not-a-uuid/roles"],
    ["delete", `/api/admin/users/not-a-uuid/roles/${uuid}`],
    ["delete", `/api/admin/users/${uuid}/roles/not-a-uuid`],
    ["post", "/api/admin/users/not-a-uuid/unlock"],
  ];

  it.each(cases)("%s %s answers 400 VALIDATION_ERROR", async (verb, path) => {
    const res = await call(verb, path);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  });

  it.each([
    ["get", "/api/filter-presets/default/transactions"],
    ["get", `/api/filter-presets/${uuid}`],
    ["get", `/api/reports/exports/${uuid}`],
    ["delete", `/api/household/invitations/${uuid}`],
  ] as const)("%s %s (not a malformed id) is not a 400 or 500", async (verb, path) => {
    const res = await call(verb, path);

    expect(res.status).not.toBe(400);
    expect(res.status).toBeLessThan(500);
  });
});
