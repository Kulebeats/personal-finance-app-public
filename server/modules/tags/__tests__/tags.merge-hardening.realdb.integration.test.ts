/**
 * NEW-19: POST /api/tags/merge validates its body, locks the tags it merges,
 * and writes its audit row inside the merge transaction. REAL HTTP, REAL DB.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, pool } from "../../../db";
import { tags, transactionTags } from "@shared/schema";
import { a, actors, app, ids, reset, snapshot, start, stop } from "./completion-r04.tags.fixture";

const merge = (body: unknown) =>
  request(app).post("/api/tags/merge").set("Cookie", actors.get("member")!.cookie).send(body as object);

async function sourceTag() {
  const id = randomUUID();
  await db.insert(tags).values({ id, householdId: a, name: `Merge source ${id.slice(0, 8)}`, usageCount: 1 });
  await db.insert(transactionTags).values({ tagId: id, transactionId: ids.sharedTx });
  return id;
}

const mergeAudit = async (targetTagId: string) => (await pool.query(
  "select household_id, user_id, action, entity_type, details from audit_logs where entity_id=$1 and details->>'operation'='merge_tags'",
  [targetTagId],
)).rows;

describe("NEW-19 tag merge input hardening (real HTTP, real PostgreSQL)", () => {
  beforeAll(start, 20000);
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());
  afterAll(stop);

  it.each([
    { targetTagId: "not-a-uuid", sourceTagIds: [ids.tag] },
    { targetTagId: ids.tag, sourceTagIds: ["not-a-uuid"] },
    { targetTagId: ids.tag, sourceTagIds: "not-an-array" },
    { targetTagId: ids.tag, sourceTagIds: [] },
    { sourceTagIds: [ids.tag] },
  ])("refuses a malformed body with a 400 and changes nothing: %j", async (body) => {
    const before = await snapshot();
    const res = await merge(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await snapshot()).toEqual(before);
  });

  it("writes the merge audit row for the target, naming the merged sources", async () => {
    const source = await sourceTag();
    await merge({ targetTagId: ids.tag, sourceTagIds: [source] }).expect(200);

    expect(await db.select().from(tags).where(eq(tags.id, source))).toEqual([]);
    expect(await mergeAudit(ids.tag)).toEqual([{
      household_id: a, user_id: actors.get("member")!.id, action: "UPDATE", entity_type: "tag",
      details: expect.objectContaining({ operation: "merge_tags", sourceTagIds: [source] }),
    }]);
  });

  it("rolls the whole merge back when its audit insert fails", async () => {
    const source = await sourceTag();
    const before = await snapshot();
    const original = pg.Client.prototype.query;
    vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: Parameters<typeof original>) {
      const result: unknown = Reflect.apply(original, this, args);
      const [query] = args as unknown as [unknown];
      const text = typeof query === "object" && query !== null && "text" in query ? query.text : query;
      if (typeof text === "string" && /insert into "audit_logs"/i.test(text)) {
        return Promise.resolve(result).then(() => { throw new Error("Synthetic audit failure"); }) as unknown as ReturnType<typeof original>;
      }
      return result as ReturnType<typeof original>;
    });

    expect((await merge({ targetTagId: ids.tag, sourceTagIds: [source] })).status).toBe(500);
    vi.restoreAllMocks();
    expect(await snapshot()).toEqual(before);
    expect(await mergeAudit(ids.tag)).toEqual([]);
  });
});
