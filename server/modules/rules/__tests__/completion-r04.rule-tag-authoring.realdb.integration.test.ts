import { randomUUID } from "crypto";
import { eq, inArray, or, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { session,
  accounts, auditLogs, categories, categoryGroups, householdMembers, households,
  rules, tags, transactionSplits, transactionTags, transactions, users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { createTestHousehold, createTestUser, getTestApp } from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

describe("R04 rule add_tags authoring boundary (real HTTP/DB)", () => {
  let app: Express;
  let cookie: string;
  let householdId: string;
  let foreignHouseholdId: string;
  let actorId: string;
  let foreignUserId: string;
  let accountId: string;
  let categoryGroupId: string;
  let categoryId: string;
  let foreignGroupId: string;
  let foreignCategoryId: string;
  let globalGroupId: string;
  let globalCategoryId: string;
  let crossedCategoryId: string;
  let ungroupedCategoryId: string;
  let legacyNullCategoryId: string;
  let deletedCategoryId: string;
  let transactionId: string;
  let ownedTagId: string;
  let foreignTagId: string;

  const condition = { type: "merchant_name", operator: "contains", value: "Rule authoring" };
  const mixedCase = (id: string) => id.replace(/[a-f]/, (letter) => letter.toUpperCase());
  const actions = (tagId: string) => [
    { type: "categorize", value: categoryId },
    { type: "add_tags", value: [ownedTagId, tagId] },
  ];

  async function state() {
    const [transaction] = await db.select({ categoryId: transactions.categoryId, amount: transactions.amount })
      .from(transactions).where(eq(transactions.id, transactionId));
    const [account] = await db.select({ balance: accounts.balance })
      .from(accounts).where(eq(accounts.id, accountId));
    const links = await db.select({ tagId: transactionTags.tagId })
      .from(transactionTags).where(eq(transactionTags.transactionId, transactionId));
    const splits = await db.select({ id: transactionSplits.id })
      .from(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
    const [owned] = await db.select({ usageCount: tags.usageCount })
      .from(tags).where(eq(tags.id, ownedTagId));
    const [foreign] = await db.select({ usageCount: tags.usageCount })
      .from(tags).where(eq(tags.id, foreignTagId));
    return {
      transaction, account, links: links.map((row) => row.tagId).sort(),
      splitIds: splits.map((row) => row.id).sort(),
      ownedCount: owned.usageCount, foreignCount: foreign.usageCount,
    };
  }

  async function ruleAudits() {
    const rows = await db.select({ id: auditLogs.id, action: auditLogs.action, entityId: auditLogs.entityId, entityType: auditLogs.entityType })
      .from(auditLogs).where(eq(auditLogs.householdId, householdId));
    return rows.filter((row) => row.action === "UPDATE" && row.entityType === "rule");
  }

  async function seedRule(tagId: string, enabled: boolean, name: string) {
    const [rule] = await db.insert(rules).values({
      householdId, name, enabled, priority: 1, conditions: [condition],
      conditionLogic: "all", actions: actions(tagId),
    }).returning();
    return rule;
  }

  async function blockedBy(blockers: number[], excluded: number[]): Promise<number> {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ pid: number }>(`
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND NOT (pid = ANY($2::integer[]))
          AND EXISTS (SELECT 1 FROM unnest(pg_blocking_pids(pid)) blocker
            WHERE blocker = ANY($1::integer[]))
        ORDER BY query_start LIMIT 1`, [blockers, excluded]);
      if (rows[0]) return rows[0].pid;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Expected rule authoring writer to reach the held PostgreSQL lock");
  }

  beforeAll(async () => {
    app = await getTestApp();
    const suffix = randomUUID();
    const actor = createTestUser({ email: `r04-rule-author-${suffix}@example.com`, username: `r04-rule-author-${suffix}` });
    const foreign = createTestUser({ email: `r04-rule-other-${suffix}@example.com`, username: `r04-rule-other-${suffix}` });
    const household = createTestHousehold(actor.id, { name: `R04 rule author ${suffix}` });
    const otherHousehold = createTestHousehold(foreign.id, { name: `R04 rule other ${suffix}` });
    actorId = actor.id;
    foreignUserId = foreign.id;
    householdId = household.id;
    foreignHouseholdId = otherHousehold.id;
    await db.insert(households).values([
      { id: household.id, name: household.name, currency: household.currency },
      { id: otherHousehold.id, name: otherHousehold.name, currency: otherHousehold.currency },
    ]);
    await db.insert(users).values([
      { id: actor.id, email: actor.email, username: actor.username, passwordHash: await hashPassword("TestPassword123"),
        fullName: actor.fullName, emailVerified: true, mfaEnabled: false, failedLoginAttempts: 0, lockedUntil: null },
      { id: foreign.id, email: foreign.email, username: foreign.username, passwordHash: await hashPassword("ForeignPassword123"),
        fullName: foreign.fullName, emailVerified: true, mfaEnabled: false, failedLoginAttempts: 0, lockedUntil: null },
    ]);
    await db.insert(householdMembers).values([
      { householdId, userId: actorId, role: "owner" },
      { householdId: foreignHouseholdId, userId: foreignUserId, role: "owner" },
    ]);
    const [group] = await db.insert(categoryGroups).values({ householdId, name: "Rule authoring group", type: "expenses", displayOrder: 1 }).returning();
    categoryGroupId = group.id;
    const [category] = await db.insert(categories).values({ householdId, groupId: categoryGroupId, name: "Allowed rule category", displayOrder: 1 }).returning();
    categoryId = category.id;
    const [foreignGroup] = await db.insert(categoryGroups).values({ householdId: foreignHouseholdId, name: "Foreign rule group", type: "expenses", displayOrder: 1 }).returning();
    foreignGroupId = foreignGroup.id;
    const [foreignCategory] = await db.insert(categories).values({ householdId: foreignHouseholdId, groupId: foreignGroupId, name: "Foreign rule category", displayOrder: 1 }).returning();
    foreignCategoryId = foreignCategory.id;
    const [globalGroup] = await db.insert(categoryGroups).values({ householdId: null, name: "Unowned rule group", type: "expenses", displayOrder: 1 }).returning();
    globalGroupId = globalGroup.id;
    const [globalCategory] = await db.insert(categories).values({ householdId: null, groupId: globalGroupId, name: "Unowned rule category", displayOrder: 1 }).returning();
    globalCategoryId = globalCategory.id;
    const [crossed] = await db.insert(categories).values({ householdId, groupId: foreignGroupId, name: "Crossed rule category", displayOrder: 2 }).returning();
    crossedCategoryId = crossed.id;
    const [ungrouped] = await db.insert(categories).values({ householdId, groupId: null, name: "Ungrouped rule category", displayOrder: 3 }).returning();
    ungroupedCategoryId = ungrouped.id;
    const [legacyNull] = await db.insert(categories).values({ householdId: null, groupId: categoryGroupId, name: "Legacy null-household rule category", displayOrder: 5 }).returning();
    legacyNullCategoryId = legacyNull.id;
    const [deleted] = await db.insert(categories).values({ householdId, groupId: categoryGroupId, name: "Deleted rule category", displayOrder: 4, deletedAt: new Date(), isArchived: true }).returning();
    deletedCategoryId = deleted.id;
    const [owned] = await db.insert(tags).values({ householdId, name: "Allowed rule tag", usageCount: 0 }).returning();
    const [other] = await db.insert(tags).values({ householdId: foreignHouseholdId, name: "Foreign rule tag", usageCount: 0 }).returning();
    ownedTagId = owned.id;
    foreignTagId = other.id;
    accountId = randomUUID();
    await db.insert(accounts).values({ id: accountId, householdId, name: "Rule authoring account", type: "checking", balance: "100.00", currency: "ZMW", isAsset: true });
    transactionId = randomUUID();
    await db.insert(transactions).values({ id: transactionId, householdId, accountId, ownerUserId: actorId,
      date: "2026-10-31", name: "Rule authoring purchase", amount: "25.00", currency: "ZMW", type: "expense", isPrivate: false, categoryId: null });
    const login = await request(app).post("/api/auth/login").send({ email: actor.email, password: "TestPassword123" }).expect(200);
    cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  });

  afterEach(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
    await db.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
    await db.delete(rules).where(eq(rules.householdId, householdId));
    await db.update(transactions).set({ categoryId: null }).where(eq(transactions.id, transactionId));
    await db.update(categories).set({ isArchived: false }).where(eq(categories.id, categoryId));
    await db.update(categories).set({ householdId: null }).where(eq(categories.id, legacyNullCategoryId));
    await db.update(tags).set({ usageCount: 0 }).where(eq(tags.id, ownedTagId));
    await db.update(tags).set({ usageCount: 0 }).where(eq(tags.id, foreignTagId));
  });

  afterAll(async () => {
    const actorIds = [actorId, foreignUserId].filter(Boolean);
    if (actorIds.length) await db.delete(session).where(or(
      inArray(sql<string>`${session.sess}->>'userId'`, actorIds),
      inArray(sql<string>`${session.sess}->>'mfaPendingUserId'`, actorIds),
    ));
    await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
    await db.delete(transactionSplits).where(eq(transactionSplits.transactionId, transactionId));
    await db.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
    await db.delete(rules).where(eq(rules.householdId, householdId));
    await db.delete(transactions).where(eq(transactions.id, transactionId));
    await db.delete(accounts).where(eq(accounts.id, accountId));
    await db.delete(tags).where(eq(tags.id, ownedTagId));
    await db.delete(tags).where(eq(tags.id, foreignTagId));
    await db.delete(categories).where(inArray(categories.id, [
      categoryId, foreignCategoryId, globalCategoryId, crossedCategoryId, ungroupedCategoryId, legacyNullCategoryId, deletedCategoryId,
    ]));
    await db.delete(categoryGroups).where(inArray(categoryGroups.id, [categoryGroupId, foreignGroupId, globalGroupId]));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdId));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, foreignHouseholdId));
    await db.delete(users).where(eq(users.id, actorId));
    await db.delete(users).where(eq(users.id, foreignUserId));
    await db.delete(households).where(eq(households.id, householdId));
    await db.delete(households).where(eq(households.id, foreignHouseholdId));
  });

  it("rejects foreign and unknown tag UUIDs identically before POST persists or applies", async () => {
    const before = await state();
    const failures: Array<{ code: string; message: string }> = [];
    for (const tagId of [foreignTagId.toUpperCase(), randomUUID().toUpperCase()]) {
      const response = await request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Invalid tag rule", conditions: [condition], actions: actions(tagId), applyToPast: true });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(tagId);
      failures.push({ code: response.body.error.code, message: response.body.error.message });
      expect(await state()).toEqual(before);
      expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);
    }
    expect(failures[0]).toEqual(failures[1]);
  });

  it("rejects missing and disabled foreign add_tags values when authoring", async () => {
    for (const action of [{ type: "add_tags" }, { type: "add_tags", value: [foreignTagId], enabled: false }]) {
      const response = await request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Invalid action", conditions: [condition], actions: [action] });
      expect(response.status).toBe(400);
      expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);
    }
  });

  it("accepts same-household mixed-case duplicate tag UUIDs through ordinary POST apply", async () => {
    const response = await request(app).post("/api/rules").set("Cookie", cookie)
      .send({ name: "Allowed rule", conditions: [condition], actions: [
        { type: "categorize", value: categoryId },
        { type: "add_tags", value: [ownedTagId.toUpperCase(), mixedCase(ownedTagId)] },
      ], applyToPast: true });
    expect(response.status).toBe(201);
    const after = await state();
    expect(after.transaction.categoryId).toBe(categoryId);
    expect(after.links).toEqual([ownedTagId]);
    expect(after.ownedCount).toBe(1);
    expect(after.foreignCount).toBe(0);
    expect(after.transaction.amount).toBe("25.00");
    expect(after.account.balance).toBe("100.00");
  });

  it("rejects foreign, unknown, unowned, and inconsistent-group categorize IDs identically before POST apply", async () => {
    const before = await state();
    const failures: Array<{ code: string; message: string }> = [];
    for (const categoryRef of [foreignCategoryId, randomUUID(), globalCategoryId, crossedCategoryId, deletedCategoryId]) {
      const response = await request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Invalid category rule", conditions: [condition], actions: [
          { type: "categorize", value: categoryRef.toUpperCase() },
          { type: "add_tags", value: [ownedTagId] },
        ], applyToPast: true });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(categoryRef.toUpperCase());
      failures.push({ code: response.body.error.code, message: response.body.error.message });
      expect(await state()).toEqual(before);
      expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);
    }
    expect(failures.every((failure) => JSON.stringify(failure) === JSON.stringify(failures[0]))).toBe(true);
  });

  it("rejects missing, array, and disabled foreign categorize values at authoring", async () => {
    for (const action of [
      { type: "categorize" },
      { type: "categorize", value: [categoryId] },
      { type: "categorize", value: foreignCategoryId, enabled: false },
    ]) {
      const response = await request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Invalid category action", conditions: [condition], actions: [action] });
      expect(response.status).toBe(400);
      expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);
    }
  });

  it("does not infer category ownership from an owned group on a legacy null-household row", async () => {
    const payload = { name: "Legacy category rule", conditions: [condition], actions: [
      { type: "categorize", value: legacyNullCategoryId },
    ] };
    const refused = await request(app).post("/api/rules").set("Cookie", cookie).send(payload);
    expect(refused.status).toBe(400);
    expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);

    // A deliberate repair of the category's own householdId, not its group's,
    // makes the same reference eligible for ordinary authoring.
    await db.update(categories).set({ householdId }).where(eq(categories.id, legacyNullCategoryId));
    await request(app).post("/api/rules").set("Cookie", cookie).send(payload).expect(201);
  });

  it("keeps archived category references authorable through the actual archive and restore routes", async () => {
    const rule = await seedRule(ownedTagId, false, "Archived category rule");
    for (const archive of [
      () => request(app).patch(`/api/categories/${categoryId}/archive`).set("Cookie", cookie),
      () => request(app).delete(`/api/categories/${categoryId}`).set("Cookie", cookie),
    ]) {
      await archive().expect(200);
      const [archived] = await db.select({ isArchived: categories.isArchived, deletedAt: categories.deletedAt })
        .from(categories).where(eq(categories.id, categoryId));
      expect(archived).toEqual({ isArchived: true, deletedAt: null });
      await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie).send({ enabled: true }).expect(200);
      await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie).send({ enabled: false }).expect(200);
      await request(app).put(`/api/categories/${categoryId}/restore`).set("Cookie", cookie).expect(200);
      const [restored] = await db.select({ isArchived: categories.isArchived, deletedAt: categories.deletedAt })
        .from(categories).where(eq(categories.id, categoryId));
      expect(restored).toEqual({ isArchived: false, deletedAt: null });
    }
  });

  it("checks each supplied split_transaction category and preserves optional uncategorized splits", async () => {
    const before = await state();
    const failures: Array<{ code: string; message: string }> = [];
    for (const categoryRef of [foreignCategoryId, randomUUID(), globalCategoryId, crossedCategoryId, deletedCategoryId]) {
      const invalid = await request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Invalid mixed split", conditions: [condition], actions: [
          { type: "add_tags", value: [ownedTagId] },
          { type: "split_transaction", value: "", splitConfig: [
            { categoryId, percentage: 50 }, { categoryId: categoryRef.toUpperCase(), percentage: 50 },
          ] },
        ], applyToPast: true });
      expect(invalid.status).toBe(400);
      expect(JSON.stringify(invalid.body)).not.toContain(categoryRef.toUpperCase());
      failures.push({ code: invalid.body.error.code, message: invalid.body.error.message });
      expect(await state()).toEqual(before);
      expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);
    }
    expect(failures.every((failure) => JSON.stringify(failure) === JSON.stringify(failures[0]))).toBe(true);

    const disabled = await request(app).post("/api/rules").set("Cookie", cookie)
      .send({ name: "Disabled invalid split", conditions: [condition], actions: [
        { type: "split_transaction", value: "", enabled: false, splitConfig: [
          { categoryId, percentage: 50 }, { categoryId: foreignCategoryId, percentage: 50 },
        ] },
      ] });
    expect(disabled.status).toBe(400);
    expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);

    const valid = await request(app).post("/api/rules").set("Cookie", cookie)
      .send({ name: "Allowed split", conditions: [condition], actions: [
        { type: "split_transaction", value: "", splitConfig: [
          { categoryId: ungroupedCategoryId.toUpperCase(), percentage: 50 }, { percentage: 50 },
        ] },
      ] });
    expect(valid.status).toBe(201);
    expect(await state()).toEqual(before);
  });

  it("rejects a stored foreign category on merged edit and re-enable but permits pure disable and repair", async () => {
    const rule = await seedRule(ownedTagId, true, "Stored foreign category rule");
    await db.update(rules).set({ actions: [
      { type: "categorize", value: foreignCategoryId },
      { type: "add_tags", value: [ownedTagId] },
    ] }).where(eq(rules.id, rule.id));
    for (const body of [{ name: "New name" }, { enabled: true }]) {
      const response = await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie).send(body);
      expect(response.status).toBe(400);
      const [stored] = await db.select().from(rules).where(eq(rules.id, rule.id));
      expect(stored.name).toBe("Stored foreign category rule");
      expect(stored.enabled).toBe(true);
    }
    const before = await state();
    await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie).send({ enabled: false }).expect(200);
    expect(await state()).toEqual(before);
    await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie)
      .send({ actions: [{ type: "categorize", value: categoryId.toUpperCase() }, { type: "add_tags", value: [ownedTagId] }] }).expect(200);
    await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie).send({ enabled: true }).expect(200);
    const [repaired] = await db.select().from(rules).where(eq(rules.id, rule.id));
    expect(repaired.enabled).toBe(true);
  });

  it("rolls back bulk enable of valid and invalid stored categorize and split rules without audit", async () => {
    const valid = await seedRule(ownedTagId, false, "Valid category rule");
    const badCategorize = await seedRule(ownedTagId, false, "Foreign categorize rule");
    const badSplit = await seedRule(ownedTagId, false, "Foreign split rule");
    await db.update(rules).set({ actions: [{ type: "categorize", value: foreignCategoryId }] })
      .where(eq(rules.id, badCategorize.id));
    await db.update(rules).set({ actions: [{ type: "split_transaction", value: "", splitConfig: [
      { categoryId, percentage: 50 }, { categoryId: foreignCategoryId, percentage: 50 },
    ] }] }).where(eq(rules.id, badSplit.id));
    const before = await state();
    const beforeAuditIds = new Set((await ruleAudits()).map((row) => row.id));
    for (const invalidId of [badCategorize.id, badSplit.id]) {
      const response = await request(app).post("/api/rules/bulk-enable").set("Cookie", cookie)
        .send({ ruleIds: [valid.id.toUpperCase(), invalidId] });
      expect(response.status).toBe(400);
      const stored = await db.select({ id: rules.id, enabled: rules.enabled }).from(rules).where(eq(rules.householdId, householdId));
      expect(stored).toEqual(expect.arrayContaining([
        { id: valid.id, enabled: false }, { id: badCategorize.id, enabled: false }, { id: badSplit.id, enabled: false },
      ]));
      expect((await ruleAudits()).filter((row) => !beforeAuditIds.has(row.id))).toHaveLength(0);
      expect(await state()).toEqual(before);
    }
  });

  it("reorder locks category rows in UUID order before applying requested display order", async () => {
    const [lower, higher] = [categoryId, ungroupedCategoryId].sort();
    const holder = await pool.connect();
    const observer = await pool.connect();
    const pending: Array<Promise<request.Response>> = [];
    try {
      await holder.query("BEGIN");
      const { rows: [{ pid: holderPid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await holder.query("SELECT id FROM categories WHERE id = $1 FOR UPDATE", [lower]);
      pending.push(request(app).post("/api/rules").set("Cookie", cookie).send({
        name: "Ordered category locks", conditions: [condition], actions: [
          { type: "categorize", value: higher },
          { type: "split_transaction", value: "", splitConfig: [{ categoryId: lower, percentage: 100 }] },
        ],
      }).then((response) => response));
      const authorPid = await blockedBy([holderPid], [holderPid]);
      pending.push(request(app).put("/api/categories/reorder").set("Cookie", cookie)
        .send({ categoryIds: [higher, lower] }).then((response) => response));
      // PostgreSQL may queue this waiter behind the already-waiting author,
      // rather than reporting the original holder as its direct blocker.
      await blockedBy([holderPid, authorPid], [holderPid, authorPid]);

      // A requested-order UPDATE would already hold higher and fail NOWAIT.
      await observer.query("BEGIN");
      const freeHigher = await observer.query("SELECT id FROM categories WHERE id = $1 FOR UPDATE NOWAIT", [higher]);
      expect(freeHigher.rowCount).toBe(1);
      await observer.query("ROLLBACK");
      await holder.query("COMMIT");
      expect((await Promise.all(pending)).map((response) => response.status)).toEqual([201, 204]);
      const ordered = await db.select({ id: categories.id, displayOrder: categories.displayOrder })
        .from(categories).where(inArray(categories.id, [lower, higher]));
      expect(ordered).toEqual(expect.arrayContaining([
        { id: higher, displayOrder: 0 }, { id: lower, displayOrder: 1 },
      ]));
    } finally {
      await observer.query("ROLLBACK");
      await holder.query("ROLLBACK");
      observer.release();
      holder.release();
      await Promise.allSettled(pending);
    }
  }, 20_000);

  it("checks the merged stored actions on name edit and re-enable, while pure disable remains available", async () => {
    const rule = await seedRule(foreignTagId, true, "Stored invalid rule");
    for (const body of [{ name: "New name" }, { enabled: true }]) {
      const response = await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie).send(body);
      expect(response.status).toBe(400);
      const [stored] = await db.select().from(rules).where(eq(rules.id, rule.id));
      expect(stored.name).toBe("Stored invalid rule");
      expect(stored.enabled).toBe(true);
    }
    const before = await state();
    await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie).send({ enabled: false }).expect(200);
    const [disabled] = await db.select().from(rules).where(eq(rules.id, rule.id));
    expect(disabled.enabled).toBe(false);
    expect(await state()).toEqual(before);
    await request(app).put(`/api/rules/${rule.id}`).set("Cookie", cookie).send({ actions: actions(ownedTagId) }).expect(200);
    await request(app).put(`/api/rules/${rule.id.toUpperCase()}`).set("Cookie", cookie).send({ enabled: true }).expect(200);
    const [repaired] = await db.select().from(rules).where(eq(rules.id, rule.id));
    expect(repaired.enabled).toBe(true);
  });

  it("rolls back mixed-case bulk enable with a foreign stored tag and writes no rule audit", async () => {
    const valid = await seedRule(ownedTagId, false, "Valid disabled rule");
    const invalid = await seedRule(foreignTagId, false, "Invalid disabled rule");
    const beforeAuditIds = new Set((await ruleAudits()).map((row) => row.id));
    const response = await request(app).post("/api/rules/bulk-enable").set("Cookie", cookie)
      .send({ ruleIds: [valid.id.toUpperCase(), mixedCase(invalid.id), valid.id] });
    expect(response.status).toBe(400);
    const stored = await db.select({ id: rules.id, enabled: rules.enabled }).from(rules).where(eq(rules.householdId, householdId));
    expect(stored).toEqual(expect.arrayContaining([{ id: valid.id, enabled: false }, { id: invalid.id, enabled: false }]));
    expect((await ruleAudits()).filter((row) => !beforeAuditIds.has(row.id))).toHaveLength(0);
  });

  it("returns and audits each canonical UUID once in first-request order for bulk enable", async () => {
    const first = await seedRule(ownedTagId, false, "First valid rule");
    const second = await seedRule(ownedTagId, false, "Second valid rule");
    const beforeAuditIds = new Set((await ruleAudits()).map((row) => row.id));
    const response = await request(app).post("/api/rules/bulk-enable").set("Cookie", cookie)
      .send({ ruleIds: [first.id.toUpperCase(), mixedCase(second.id), first.id] });
    expect(response.status).toBe(200);
    expect(response.body.data.count).toBe(2);
    expect(response.body.data.rules.map((rule: { id: string }) => rule.id)).toEqual([first.id, second.id]);
    const stored = await db.select({ id: rules.id, enabled: rules.enabled }).from(rules).where(eq(rules.householdId, householdId));
    expect(stored).toEqual(expect.arrayContaining([{ id: first.id, enabled: true }, { id: second.id, enabled: true }]));
    expect((await ruleAudits()).filter((row) => !beforeAuditIds.has(row.id)).map((row) => row.entityId).sort())
      .toEqual([first.id, second.id].sort());
  });

  it("locks the full bulk rule set before tag rows when a single re-enable contends", async () => {
    const sorted = [await seedRule(ownedTagId, false, "Lower rule"), await seedRule(ownedTagId, false, "Higher rule")]
      .sort((a, b) => a.id.localeCompare(b.id));
    const holder = await pool.connect();
    const pending: Array<Promise<request.Response>> = [];
    try {
      await holder.query("BEGIN");
      const { rows: [{ pid: holderPid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await holder.query("SELECT id FROM tags WHERE id = $1 FOR UPDATE", [ownedTagId]);
      pending.push(request(app).post("/api/rules/bulk-enable").set("Cookie", cookie)
        .send({ ruleIds: sorted.map((rule) => rule.id) }).then((response) => response));
      const bulkPid = await blockedBy([holderPid], [holderPid]);
      pending.push(request(app).put(`/api/rules/${sorted[1].id}`).set("Cookie", cookie)
        .send({ enabled: true }).then((response) => response));
      await blockedBy([holderPid, bulkPid], [holderPid, bulkPid]);
      await holder.query("COMMIT");
      expect((await Promise.all(pending)).map((response) => response.status)).toEqual([200, 200]);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await Promise.allSettled(pending);
    }
  }, 20_000);

  it("uses the same canonical rule-row order as reorder during bulk enable", async () => {
    const [lower, higher] = [
      await seedRule(ownedTagId, false, "First reorder rule"),
      await seedRule(ownedTagId, false, "Second reorder rule"),
    ].sort((a, b) => a.id.localeCompare(b.id));
    const holder = await pool.connect();
    const pending: Array<Promise<request.Response>> = [];
    try {
      await holder.query("BEGIN");
      const { rows: [{ pid: holderPid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await holder.query("SELECT id FROM rules WHERE id = $1 FOR UPDATE", [lower.id]);
      pending.push(request(app).post("/api/rules/bulk-enable").set("Cookie", cookie)
        .send({ ruleIds: [higher.id, lower.id] }).then((response) => response));
      const bulkPid = await blockedBy([holderPid], [holderPid]);
      pending.push(request(app).put("/api/rules/reorder").set("Cookie", cookie)
        .send({ rules: [{ id: higher.id, priority: 0 }, { id: lower.id, priority: 1 }] })
        .then((response) => response));
      await blockedBy([holderPid, bulkPid], [holderPid, bulkPid]);
      await holder.query("COMMIT");
      expect((await Promise.all(pending)).map((response) => response.status)).toEqual([200, 200]);
      const stored = await db.select({ id: rules.id, enabled: rules.enabled, priority: rules.priority })
        .from(rules).where(eq(rules.householdId, householdId));
      expect(stored).toEqual(expect.arrayContaining([
        { id: lower.id, enabled: true, priority: 1 },
        { id: higher.id, enabled: true, priority: 0 },
      ]));
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await Promise.allSettled(pending);
    }
  }, 20_000);

  it("keeps authoring compatible with an in-flight non-key tag count update", async () => {
    const holder = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("UPDATE tags SET usage_count = usage_count WHERE id = $1", [ownedTagId]);
      pending = request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Compatible count writer", conditions: [condition], actions: actions(ownedTagId) })
        .then((response) => response);
      const response = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Rule authoring blocked on non-key tag update")), 4000);
        }),
      ]);
      expect(response.status).toBe(201);
    } finally {
      if (timer) clearTimeout(timer);
      await holder.query("ROLLBACK");
      holder.release();
      if (pending) await Promise.allSettled([pending]);
    }
  }, 15_000);

  it("takes the household before tags when an ordinary direct tag writer holds it", async () => {
    const holder = await pool.connect();
    const pending: Array<Promise<request.Response>> = [];
    try {
      await holder.query("BEGIN");
      const { rows: [{ pid: holderPid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await holder.query("SELECT id FROM transactions WHERE id = $1 FOR UPDATE", [transactionId]);
      pending.push(request(app).post(`/api/tags/transaction/${transactionId}`).set("Cookie", cookie)
        .send({ tagIds: [ownedTagId] }).then((response) => response));
      const directPid = await blockedBy([holderPid], [holderPid]);
      pending.push(request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Household lock order", conditions: [condition], actions: actions(ownedTagId) })
        .then((response) => response));
      await blockedBy([directPid], [holderPid, directPid]);
      await holder.query("COMMIT");
      expect((await Promise.all(pending)).map((response) => response.status)).toEqual([200, 201]);
      const after = await state();
      expect(after.links).toEqual([ownedTagId]);
      expect(after.ownedCount).toBe(1);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await Promise.allSettled(pending);
    }
  }, 20_000);

  it("refuses an author whose membership is downgraded before the locked write", async () => {
    const holder = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await holder.query("BEGIN");
      const { rows: [{ pid: holderPid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await holder.query("UPDATE household_members SET role = 'view_only' WHERE household_id = $1 AND user_id = $2", [householdId, actorId]);
      pending = request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Downgraded author", conditions: [condition], actions: actions(ownedTagId) })
        .then((response) => response);
      await blockedBy([holderPid], [holderPid]);
      await holder.query("COMMIT");
      expect((await pending).status).toBe(403);
      expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      if (pending) await Promise.allSettled([pending]);
      await db.update(householdMembers).set({ role: "owner" })
        .where(eq(householdMembers.householdId, householdId));
    }
  }, 20_000);

  it("waits for a pending tag delete, then refuses the committed missing reference", async () => {
    const [deleteTarget] = await db.insert(tags).values({
      householdId, name: "Pending delete rule tag", usageCount: 0,
    }).returning();
    const holder = await pool.connect();
    let pending: Promise<request.Response> | undefined;
    try {
      await holder.query("BEGIN");
      const { rows: [{ pid: holderPid }] } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await holder.query("DELETE FROM tags WHERE id = $1", [deleteTarget.id]);
      pending = request(app).post("/api/rules").set("Cookie", cookie)
        .send({ name: "Deleted tag reference", conditions: [condition], actions: actions(deleteTarget.id) })
        .then((response) => response);
      await blockedBy([holderPid], [holderPid]);
      await holder.query("COMMIT");
      const response = await pending;
      expect(response.status).toBe(400);
      expect(await db.select({ id: rules.id }).from(rules).where(eq(rules.householdId, householdId))).toHaveLength(0);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      if (pending) await Promise.allSettled([pending]);
      await db.delete(tags).where(eq(tags.id, deleteTarget.id));
    }
  }, 20_000);
});
