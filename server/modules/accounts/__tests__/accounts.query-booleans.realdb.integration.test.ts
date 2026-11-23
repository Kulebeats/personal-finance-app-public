/**
 * NEW-36: a query flag sent as the string "false" means false. `z.coerce.boolean()` ran
 * JS Boolean("false") === true, so `?includeArchived=false` returned archived accounts.
 * Real HTTP request against real Postgres.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSignedHousehold, insertAccount, type SignedHousehold,
} from "../../../__tests__/signed-household-fixture";

let fx: SignedHousehold;
let activeId: string;
let archivedId: string;

const listIds = async (query: string) => {
  const res = await request(fx.app).get(`/api/accounts${query}`).set(fx.headers);
  const ids = res.status === 200 ? (res.body.data as Array<{ id: string }>).map(({ id }) => id).sort() : [];
  return { status: res.status, ids };
};

describe("NEW-36 strict query booleans on GET /api/accounts (real Postgres)", () => {
  beforeAll(async () => {
    fx = await createSignedHousehold("new36-query-bool");
    activeId = await insertAccount(fx, { name: "Synthetic active" });
    archivedId = await insertAccount(fx, { name: "Synthetic archived", isArchived: true });
  }, 30000);

  afterAll(async () => { if (fx) await fx.cleanup(); });

  it("includeArchived=false hides the archived account, =true shows it", async () => {
    expect(await listIds("?includeArchived=false")).toEqual({ status: 200, ids: [activeId] });
    expect(await listIds("")).toEqual({ status: 200, ids: [activeId] });
    expect(await listIds("?includeArchived=true")).toEqual({ status: 200, ids: [activeId, archivedId].sort() });
  });

  it("refuses a flag that is neither true nor false with 400", async () => {
    expect((await listIds("?includeArchived=yes")).status).toBe(400);
  });
});
