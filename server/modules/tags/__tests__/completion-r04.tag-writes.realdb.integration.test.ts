import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import { accounts, auditLogs, householdMembers, tags, transactionTags, transactions } from "@shared/schema";
import { businessAuditService } from "../../../services/BusinessAuditService";
import { householdRepository } from "../../../repositories/HouseholdRepository";
import { tagService } from "../tags.service";
import { a, b, actors, app, ids, reset, roles, snapshot, start, stop, type Role } from "./completion-r04.tags.fixture";

export type Operation = "add" | "set" | "remove";
export const operations = ["add", "set", "remove"] as const;
export const write = (operation: Operation, role: Role | "outsider" = "member", transactionId: string = ids.sharedTx, tagIds: string[] = [ids.tag]) => {
  const path = `/api/tags/transaction/${transactionId}`;
  const call = operation === "remove" ? request(app).delete(`${path}/${tagIds[0]}`)
    : operation === "add" ? request(app).post(path) : request(app).put(path);
  return call.set("Cookie", actors.get(role)!.cookie).send(operation === "remove" ? {} : { tagIds });
};
async function state() {
  return { ...await snapshot(), transactions: await db.select().from(transactions).where(inArray(transactions.householdId, [a, b])).orderBy(transactions.id) };
}
async function newTag() {
  const id = randomUUID();
  await db.insert(tags).values({ id, householdId: a, name: `Writer ${id}`, usageCount: 0 });
  return id;
}

describe("R04 atomic single-transaction tag writers with real cookies", () => {
  beforeAll(start, 20000);
  beforeEach(reset);
  afterEach(() => vi.restoreAllMocks());
  afterAll(stop);

  it.each(roles)("%s capability applies to all three writes with clean controls", async (role) => {
    const before = await state(), allowed = ["owner", "admin", "member"].includes(role);
    for (const operation of operations) await write(operation, role).expect(allowed ? 200 : 403);
    if (!allowed) expect(await state()).toEqual(before);
    else {
      expect((await db.select().from(tags).where(eq(tags.id, ids.tag)))[0].usageCount).toBe(1);
      const audit = await db.select().from(auditLogs).where(eq(auditLogs.userId, actors.get(role)!.id));
      expect(audit).toHaveLength(3);
      expect(audit.every((row) => row.householdId === a && row.entityId === ids.sharedTx)).toBe(true);
    }
  });

  it.each(operations)("%s enforces containing account and transaction privacy/deletion/household", async (operation) => {
    for (const variant of ["private account", "private transaction", "deleted account", "deleted transaction", "foreign parent"] as const) {
      await reset();
      if (variant === "private transaction") await db.update(transactions).set({ accountId: ids.sharedAccount, isPrivate: true }).where(eq(transactions.id, ids.privateTx));
      if (variant === "deleted account") await db.update(accounts).set({ deletedAt: new Date() }).where(eq(accounts.id, ids.sharedAccount));
      if (variant === "deleted transaction") await db.update(transactions).set({ deletedAt: new Date() }).where(eq(transactions.id, ids.sharedTx));
      if (variant === "foreign parent") await db.update(transactions).set({ accountId: ids.foreignAccount }).where(eq(transactions.id, ids.privateTx));
      const before = await state();
      const target = variant.startsWith("deleted") ? ids.sharedTx : ids.privateTx;
      await write(operation, "member", target).expect(404);
      expect(await state()).toEqual(before);
    }
    await reset();
    await write(operation, "owner", ids.privateTx).expect(200);
  });

  it.each(operations)("%s rejects foreign supplied or existing references without cleanup", async (operation) => {
    const before = await state();
    await write(operation, "member", ids.sharedTx, [ids.foreignTag]).expect(404);
    await write(operation, "outsider").expect(404);
    expect(await state()).toEqual(before);
    await db.insert(transactionTags).values({ transactionId: ids.sharedTx, tagId: ids.foreignTag });
    const corrupt = await state();
    await write(operation).expect(404);
    expect(await state()).toEqual(corrupt);
  });

  it("duplicate add, absent removal and exact set difference preserve physical counts", async () => {
    const other = await newTag();
    const seen = new Set<string>();
    async function audit(operation: string, addedTagIds: string[], removedTagIds: string[]) {
      const rows = await db.select().from(auditLogs).where(eq(auditLogs.userId, actors.get("member")!.id));
      const fresh = rows.filter((row) => !seen.has(row.id));
      expect(fresh).toHaveLength(1);
      expect(fresh[0].details).toEqual({ operation, addedTagIds, removedTagIds });
      seen.add(fresh[0].id);
    }
    await write("add", "member", ids.sharedTx, [ids.tag, other, other]).expect(200);
    await audit("add_tags", [other], []);
    await write("add", "member", ids.sharedTx, [other]).expect(200);
    await audit("add_tags", [], []);
    expect((await db.select().from(tags).where(eq(tags.id, other)))[0].usageCount).toBe(1);
    await write("set", "member", ids.sharedTx, [ids.tag, ids.tag]).expect(200);
    await audit("set_tags", [], [other]);
    expect((await db.select().from(tags).where(eq(tags.id, other)))[0].usageCount).toBe(0);
    await write("remove", "member", ids.sharedTx, [other]).expect(200);
    await audit("remove_tag", [], []);
    expect((await db.select().from(tags).where(eq(tags.id, other)))[0].usageCount).toBe(0);
    await write("set", "member", ids.sharedTx, []).expect(200);
    await audit("set_tags", [], [ids.tag]);
    expect((await db.select().from(tags).where(eq(tags.id, ids.tag)))[0].usageCount).toBe(1);
    expect(await db.select().from(transactionTags).where(eq(transactionTags.transactionId, ids.sharedTx))).toEqual([]);
  });

  it.each(operations)("%s validates persisted member references without inventing tag ownership", async (operation) => {
    for (const invalid of ["foreign", "removed"] as const) {
      await reset();
      const memberId = actors.get(invalid === "foreign" ? "outsider" : "admin")!.id;
      await db.update(tags).set({ memberId }).where(eq(tags.id, ids.tag));
      if (invalid === "removed") await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, memberId)));
      const before = await state();
      await write(operation).expect(404);
      expect(await state()).toEqual(before);
    }
    await reset();
    await db.update(tags).set({ memberSpecific: true, memberId: actors.get("professional")!.id }).where(eq(tags.id, ids.tag));
    await write(operation).expect(200);
  });

  it("normalizes mixed-case tag UUIDs before deduplication, set difference and removal", async () => {
    const other = await newTag();
    await write("add", "member", ids.sharedTx.toUpperCase(), [ids.tag.toUpperCase(), ids.tag]).expect(200);
    await write("add", "member", ids.sharedTx, [other.toUpperCase(), other]).expect(200);
    await write("set", "member", ids.sharedTx, [ids.tag.toUpperCase(), other.toUpperCase(), other]).expect(200);
    expect((await db.select().from(tags).where(eq(tags.id, ids.tag)))[0].usageCount).toBe(2);
    expect((await db.select().from(tags).where(eq(tags.id, other)))[0].usageCount).toBe(1);
    await write("remove", "member", ids.sharedTx, [other.toUpperCase()]).expect(200);
    await write("set", "member", ids.sharedTx, []).expect(200);
    expect((await db.select().from(tags).where(eq(tags.id, ids.tag)))[0].usageCount).toBe(1);
    expect((await db.select().from(tags).where(eq(tags.id, other)))[0].usageCount).toBe(0);
  });

  it("normalizes validated direct actor UUIDs before membership and private-owner comparisons", async () => {
    const actor = { householdId: a.toUpperCase(), userId: actors.get("owner")!.id.toUpperCase(), role: "owner" as const };
    await expect(tagService.addTransactionTags(ids.privateTx.toUpperCase(), [ids.tag.toUpperCase()], actor))
      .resolves.toEqual({ added: 0, removed: 0 });
    expect((await db.select().from(tags).where(eq(tags.id, ids.tag)))[0].usageCount).toBe(2);
  });

  it.each(operations)("%s rolls link/counter and an inserted audit back when audit fails", async (operation) => {
    const other = await newTag(), before = await state(), original = businessAuditService.log.bind(businessAuditService);
    let sawTx = false;
    vi.spyOn(businessAuditService, "log").mockImplementationOnce(async (entry) => {
      sawTx = !!entry.tx; await original(entry); throw new Error("Synthetic audit after-insert failure");
    });
    await write(operation, "member", ids.sharedTx, operation === "remove" ? [ids.tag] : [other]).expect(500);
    expect(sawTx).toBe(true);
    expect(await state()).toEqual(before);
  });

  it.each([null, -1, 987])("does not repair inconsistent counter %s or disclose it", async (usageCount) => {
    await db.update(tags).set({ usageCount }).where(eq(tags.id, ids.tag));
    const before = await state();
    for (const operation of operations) {
      const response = await write(operation).expect(409);
      expect(response.body).toEqual({
        success: false,
        error: {
          code: "CONFLICT",
          message: "Tag state requires reconciliation",
          timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        },
      });
      expect(await state()).toEqual(before);
    }
  });

  it("rejects unknown roles and stale removed/downgraded membership before writes", async () => {
    const original = householdRepository.findMember.bind(householdRepository);
    for (const mode of ["unknown", "remove", "downgrade"] as const) {
      await reset();
      vi.spyOn(householdRepository, "findMember").mockImplementationOnce(async (...args) => {
        const member = await original(...args);
        if (mode === "unknown") return { ...member, role: "operator" } as never;
        if (mode === "remove") await db.delete(householdMembers).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
        else await db.update(householdMembers).set({ role: "view_only" }).where(and(eq(householdMembers.householdId, a), eq(householdMembers.userId, actors.get("member")!.id)));
        return member;
      });
      const before = await state();
      await write("remove").expect(403);
      expect(await state()).toEqual(before);
      vi.restoreAllMocks();
    }
  });

  it("malformed mutation IDs are400 and unsupported body keys never partially write", async () => {
    const before = await state();
    for (const operation of operations) await write(operation, "member", "not-a-uuid").expect(400);
    await write("remove", "member", ids.sharedTx, ["bad"]).expect(400);
    await request(app).post(`/api/tags/transaction/${ids.sharedTx}`).set("Cookie", actors.get("member")!.cookie).send({ tagIds: [ids.tag], householdId: b }).expect(400);
    expect(await state()).toEqual(before);
  });
});
