/**
 * Register re-check defect 9: a malformed id on the tag, category and
 * merchant-alias routes answers 400 VALIDATION_ERROR at the route boundary,
 * before any database call, instead of reaching Postgres as an invalid uuid
 * and returning 500. Same check as the money routers (NEW-33,
 * api-routing.realdb). Real HTTP against the real routers and real Postgres.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSignedHousehold, type SignedHousehold } from "../../__tests__/signed-household-fixture";

type Verb = "get" | "post" | "put" | "patch" | "delete";
let fx: SignedHousehold;
const uuid = randomUUID();

function call(verb: Verb, path: string) {
  return request(fx.app)[verb](path).set(fx.headers).send({});
}

describe("defect 9: malformed ids on tag, category and merchant-alias routes (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("defect9-ids");
  }, 30000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  const cases: ReadonlyArray<readonly [Verb, string]> = [
    ["get", "/api/tags/not-a-uuid"],
    ["put", "/api/tags/not-a-uuid"],
    ["delete", "/api/tags/not-a-uuid"],
    ["post", "/api/tags/not-a-uuid/archive"],
    ["get", "/api/tags/not-a-uuid/transactions"],
    ["get", "/api/tags/transaction/not-a-uuid"],
    ["post", "/api/tags/transaction/not-a-uuid"],
    ["put", "/api/tags/transaction/not-a-uuid"],
    ["delete", `/api/tags/transaction/${uuid}/not-a-uuid`],
    ["delete", "/api/tags/transaction/not-a-uuid/" + uuid],
    ["get", "/api/categories/not-a-uuid"],
    ["put", "/api/categories/not-a-uuid"],
    ["delete", "/api/categories/not-a-uuid"],
    ["patch", "/api/categories/not-a-uuid/archive"],
    ["put", "/api/categories/not-a-uuid/restore"],
    ["put", "/api/categories/groups/not-a-uuid"],
    ["delete", "/api/categories/groups/not-a-uuid"],
    ["put", "/api/categories/groups/not-a-uuid/restore"],
    ["delete", `/api/merchants/${uuid}/aliases/not-a-uuid`],
  ];

  it.each(cases)("%s %s answers 400 VALIDATION_ERROR", async (verb, path) => {
    const res = await call(verb, path);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  });

  it.each([
    ["get", `/api/tags/${uuid}`],
    ["delete", `/api/tags/${uuid}`],
    ["get", `/api/categories/${uuid}`],
    ["delete", `/api/categories/groups/${uuid}`],
  ] as const)("a well-formed unknown id on %s %s is not a 400 or 500", async (verb, path) => {
    const res = await call(verb, path);

    expect(res.status).not.toBe(400);
    expect(res.status).toBeLessThan(500);
  });
});
