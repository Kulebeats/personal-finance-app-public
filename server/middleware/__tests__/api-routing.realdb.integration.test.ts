/**
 * NEW-33: unknown /api paths answer a V7 JSON 404 (never the SPA's index.html, never an HTML
 * "Cannot GET"), and a malformed id on the money routers answers 400 VALIDATION_ERROR instead of
 * reaching Postgres and returning 500. Real HTTP against the real routers and real Postgres.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSignedHousehold, type SignedHousehold } from "../../__tests__/signed-household-fixture";

type Verb = "get" | "post" | "put" | "patch" | "delete";
let fx: SignedHousehold;
const uuid = randomUUID();

function call(verb: Verb, path: string) {
  return request(fx.app)[verb](path).set(fx.headers);
}

describe("NEW-33 API routing (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("new33-routing");
  }, 30000);

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  describe("unknown /api paths", () => {
    it.each(["get", "post", "put", "patch", "delete"] as const)("%s answers a JSON 404 in the V7 envelope", async verb => {
      const res = await call(verb, "/api/definitely-not-a-route");

      expect(res.status).toBe(404);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND", message: expect.any(String) } });
    });

    it("answers a JSON 404 under a known prefix too", async () => {
      const res = await call("get", "/api/recurring/nope/nope/nope");

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    });

    it("does not alias /api/v1/* onto /api/* (the v1 mount only forwards, it never strips the prefix)", async () => {
      const res = await call("get", "/api/v1/accounts");

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    });

    it("still serves real routes", async () => {
      await call("get", "/api/accounts").expect(200);
    });
  });

  describe("malformed ids", () => {
    const cases: ReadonlyArray<readonly [Verb, string]> = [
      ["get", "/api/transactions/not-a-uuid"],
      ["get", `/api/transactions/${uuid}/attachments/not-a-uuid/download`],
      ["get", "/api/accounts/not-a-uuid"],
      ["get", "/api/budgets/not-a-uuid"],
      ["get", "/api/goals/not-a-uuid"],
      ["delete", `/api/goals/${uuid}/accounts/not-a-uuid`],
      ["get", "/api/recurring/not-a-uuid"],
      ["get", "/api/recurring/detect"],
      ["get", "/api/rules/not-a-uuid"],
      ["get", "/api/receipts/not-a-uuid"],
      ["get", "/api/investments/holdings/not-a-uuid"],
      ["get", "/api/merchants/not-a-uuid"],
    ];

    it.each(cases)("%s %s answers 400 VALIDATION_ERROR", async (verb, path) => {
      const res = await call(verb, path);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
    });

    it.each(["accounts", "budgets", "goals", "rules", "merchants"])("a well-formed unknown id on /api/%s is not a 400 or 500", async prefix => {
      const res = await call("get", `/api/${prefix}/${uuid}`);

      expect(res.status).not.toBe(400);
      expect(res.status).toBeLessThan(500);
    });
  });
});
