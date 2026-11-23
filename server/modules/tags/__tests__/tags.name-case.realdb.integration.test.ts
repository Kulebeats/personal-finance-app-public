/**
 * NEW-36: tag names are unique per household regardless of case. "Groceries" and
 * "groceries" could both be created, and a tag could be renamed into another's name with
 * different case. Create and rename now check case-insensitively inside the write
 * transaction (409). Real HTTP against real Postgres, shared R04 fixture (tag "A5Tag").
 */
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { tags } from "@shared/schema";
import { db } from "../../../db";
import { a, b, actors, app, ids, reset, start, stop } from "./completion-r04.tags.fixture";

const member = () => actors.get("member")!.cookie;
const create = (name: string) => request(app).post("/api/tags").set("Cookie", member()).send({ name });
const rename = (id: string, name: string) => request(app).put(`/api/tags/${id}`).set("Cookie", member()).send({ name });
const namesLike = async (name: string) => (await db.select({ name: tags.name }).from(tags)
  .where(and(eq(tags.householdId, a), sql`LOWER(${tags.name}) = LOWER(${name})`))).map(row => row.name).sort();

describe("NEW-36 tag names are unique case-insensitively (real Postgres)", () => {
  beforeAll(async () => { await start(); }, 30000);
  beforeEach(async () => { await reset(); });
  afterAll(async () => {
    await db.delete(tags).where(inArray(tags.householdId, [a, b]));
    await stop();
  });

  it("refuses to create a name that differs from an existing tag only by case", async () => {
    const res = await create("a5TAG");
    expect(res.status).toBe(409);
    expect(await namesLike("A5Tag")).toEqual(["A5Tag"]);
  });

  it("refuses to rename a tag into another tag's name with different case", async () => {
    const other = await create("Synthetic Groceries");
    expect(other.status).toBe(201);
    const res = await rename(ids.tag, "SYNTHETIC GROCERIES");
    expect(res.status).toBe(409);
    expect(await namesLike("synthetic groceries")).toEqual(["Synthetic Groceries"]);
    expect(await namesLike("A5Tag")).toEqual(["A5Tag"]);
  });

  it("lets a tag change the case of its own name", async () => {
    const res = await rename(ids.tag, "A5TAG");
    expect(res.status).toBe(200);
    expect(await namesLike("a5tag")).toEqual(["A5TAG"]);
  });

  it("two concurrent creates of one name in different case leave exactly one tag", async () => {
    const results = await Promise.all([create("Synthetic Race"), create("synthetic race")]);
    expect(results.map(res => res.status).sort()).toEqual([201, 409]);
    expect(await namesLike("synthetic race")).toHaveLength(1);
  });
});
