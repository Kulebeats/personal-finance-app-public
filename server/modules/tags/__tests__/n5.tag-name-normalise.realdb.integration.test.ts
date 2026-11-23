/**
 * N5 (owner ruling, 20 Nov): tag names were compared as stored, so "Food" and "Food " were
 * two tags. Create and rename now trim and NFC-normalise the name before the uniqueness
 * check and the write. Existing rows are not touched (no backfill), so an old untrimmed
 * tag can be renamed to its trimmed form unless a trimmed twin already exists (409).
 * Real HTTP against real Postgres, shared R04 fixture.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tags } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, ids, reset, start, stop } from "./completion-r04.tags.fixture";

const member = () => actors.get("member")!.cookie;
const memberId = () => actors.get("member")!.id;
/** An Account Detail CSV import of one row carrying the given tag cell, as the member. */
const importTagged = (tagCell: string) => request(app).post(`/api/accounts/${ids.sharedAccount}/transactions/import`)
  .set("Cookie", member()).set("X-Capital-Subject", memberId()).set("X-Capital-Household", a)
  .send({ adjustBalance: false, transactions: [{ date: "2026-10-06", merchant: "Synthetic A-33 cafe", amount: "-4.00", tags: tagCell }] });
const create = (name: string) => request(app).post("/api/tags").set("Cookie", member()).send({ name });
const rename = (id: string, name: string) => request(app).put(`/api/tags/${id}`).set("Cookie", member()).send({ name });
const namesLike = async (pattern: string) => (await db.select({ name: tags.name }).from(tags)
  .where(and(eq(tags.householdId, a), sql`LOWER(${tags.name}) LIKE LOWER(${pattern})`))).map(row => row.name).sort();
/** A row written before N5, stored exactly as given. */
async function legacyTag(name: string): Promise<string> {
  const id = randomUUID();
  await db.insert(tags).values({ id, householdId: a, name });
  return id;
}

const CAFE_NFC = "Café";
const CAFE_NFD = "Café";

describe("N5 tag names are trimmed and NFC-normalised on create and rename (real Postgres)", () => {
  beforeAll(async () => { await start(); }, 30000);
  beforeEach(async () => { await reset(); });
  afterAll(async () => {
    await db.delete(tags).where(inArray(tags.householdId, [a, b]));
    await stop();
  });

  it('stores "Food " as "Food"', async () => {
    const res = await create("Food ");
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Food");
    expect(await namesLike("%food%")).toEqual(["Food"]);
  });

  it("refuses a name that matches an existing tag once trimmed (409)", async () => {
    expect((await create("Food")).status).toBe(201);
    const res = await create("  food ");
    expect(res.status).toBe(409);
    expect(await namesLike("%food%")).toEqual(["Food"]);
  });

  it("refuses the NFD spelling of a name stored in NFC (409)", async () => {
    expect((await create(CAFE_NFC)).status).toBe(201);
    const res = await create(CAFE_NFD);
    expect(res.status).toBe(409);
    const stored = await namesLike("caf%");
    expect(stored).toEqual([CAFE_NFC]);
  });

  it("stores an NFD name in NFC", async () => {
    const res = await create(CAFE_NFD);
    expect(res.status).toBe(201);
    expect(await namesLike("caf%")).toEqual([CAFE_NFC]);
  });

  it("an account CSV import reuses the tag saved in settings for its NFD spelling (A-33)", async () => {
    const saved = await create(CAFE_NFC);
    expect(saved.status).toBe(201);
    const res = await importTagged(` ${CAFE_NFD} `);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ imported: 1, skipped: 0 });
    // One tag, the one settings created, now linked to the imported row; no look-alike.
    expect(await namesLike("caf%")).toEqual([CAFE_NFC]);
    const linked = await db.execute<{ tag_id: string }>(sql`SELECT tt.tag_id FROM transaction_tags tt
      JOIN transactions t ON t.id = tt.transaction_id WHERE t.account_id = ${ids.sharedAccount} AND t.date = '2026-10-06'`);
    expect(linked.rows.map(row => row.tag_id)).toEqual([saved.body.data.id]);
  });

  it("refuses a name that is only whitespace (400)", async () => {
    const res = await create("   ");
    expect(res.status).toBe(400);
    expect(await namesLike("   ")).toEqual([]);
  });

  it("renames an old untrimmed tag to its trimmed form when no trimmed twin exists", async () => {
    const id = await legacyTag("Rent ");
    const res = await rename(id, "Rent");
    expect(res.status).toBe(200);
    expect(await namesLike("%rent%")).toEqual(["Rent"]);
  });

  it("refuses to rename an old untrimmed tag onto its existing trimmed twin (409)", async () => {
    const id = await legacyTag("Rent ");
    expect((await create("Rent")).status).toBe(201);
    const res = await rename(id, "Rent");
    expect(res.status).toBe(409);
    expect(await namesLike("%rent%")).toEqual(["Rent", "Rent "]);
  });
});
