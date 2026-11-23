import { randomUUID } from "crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  categories,
  categoryGroups,
  householdMembers,
  households,
  tags,
  users,
} from "@shared/schema";
import {
  DEFAULT_CATEGORIES,
  DEFAULT_CATEGORY_GROUPS,
  DEFAULT_GROUP_COLORS,
} from "../../config/defaultCategories";
import { seedDefaultCategories } from "../../seed";
import { householdRepository } from "../HouseholdRepository";
import { ConflictError, NotFoundError } from "../../core/errors";
import { withTransaction } from "../../utils/withTransaction";

describe("R02 first-household category defaults — real database", () => {
  const householdIds: string[] = [];
  const userIds: string[] = [];
  const householdNames: string[] = [];

  afterEach(async () => {
    for (const name of householdNames.splice(0)) {
      const rows = await db.select().from(households).where(eq(households.name, name));
      householdIds.push(...rows.map((row) => row.id));
    }
    for (const id of householdIds.splice(0)) {
      await db.delete(households).where(eq(households.id, id));
    }
    for (const id of userIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function emptyHousehold() {
    const [household] = await db.insert(households).values({
      name: `r02-defaults-${randomUUID()}`,
      currency: "ZMW",
    }).returning();
    householdIds.push(household.id);
    return household;
  }

  async function newOwner() {
    const [user] = await db.insert(users).values({
      email: `r02-defaults-${randomUUID()}@example.invalid`,
      username: `r02-${randomUUID()}`,
      passwordHash: "synthetic-unused-password-hash",
      fullName: "Synthetic category owner",
      emailVerified: true,
    }).returning();
    userIds.push(user.id);
    return user;
  }

  async function tree(householdId: string) {
    const [groups, categoryRows] = await Promise.all([
      db.select().from(categoryGroups).where(eq(categoryGroups.householdId, householdId))
        .orderBy(categoryGroups.id),
      db.select().from(categories).where(eq(categories.householdId, householdId))
        .orderBy(categories.id),
    ]);
    return { groups, categories: categoryRows };
  }

  async function expectExactDefaults(householdId: string) {
    const actual = await tree(householdId);
    expect(actual.groups).toHaveLength(13);
    expect(actual.categories).toHaveLength(84);
    expect(actual.groups.map(({ id, createdAt, updatedAt, ...group }) => group)
      .sort((a, b) => a.displayOrder - b.displayOrder))
      .toEqual(DEFAULT_CATEGORY_GROUPS.map((group) => ({ householdId, ...group })));
    const groupNames = new Map(actual.groups.map((group) => [group.id, group.name]));
    expect(actual.categories.map(({ id, createdAt, updatedAt, groupId, ...category }) => ({
      ...category, group: groupId ? groupNames.get(groupId) : undefined,
    })).sort((a, b) => a.displayOrder - b.displayOrder)).toEqual(
      DEFAULT_CATEGORIES.map((category, index) => ({
        householdId,
        group: category.group,
        name: category.name,
        icon: category.icon || null,
        color: DEFAULT_GROUP_COLORS[category.group] || "#6B7280",
        includeInBudget: category.group !== "Transfers & Adjustments",
        rolloverEnabled: false,
        rolloverStartBalance: null,
        isArchived: false,
        displayOrder: index + 1,
        deletedAt: null,
      })),
    );
    expect(actual.categories.every((category) => category.groupId &&
      actual.groups.some((group) => group.id === category.groupId &&
        group.householdId === category.householdId))).toBe(true);
  }

  it("creates the exact current defaults with the household, owner and eight tags", async () => {
    const owner = await newOwner();
    const name = `r02-created-${randomUUID()}`;
    householdNames.push(name);
    const household = await householdRepository.createWithOwner({ name, currency: "ZMW", userId: owner.id });
    await expectExactDefaults(household.id);
    expect(await db.select().from(householdMembers).where(eq(householdMembers.householdId, household.id)))
      .toMatchObject([{ userId: owner.id, role: "owner" }]);
    expect(await db.select().from(tags).where(eq(tags.householdId, household.id))).toHaveLength(8);
  });

  it("repeating standalone seeding preserves every existing ID and field", async () => {
    const household = await emptyHousehold();
    await seedDefaultCategories(household.id);
    const before = await tree(household.id);
    await seedDefaultCategories(household.id);
    expect(await tree(household.id)).toEqual(before);
  });

  it.each([
    { state: "active", isArchived: false, deletedAt: null },
    { state: "archived", isArchived: true, deletedAt: null },
    { state: "soft-deleted", isArchived: false, deletedAt: new Date("2026-01-01T00:00:00.000Z") },
  ])("preserves a single $state customized category without filling gaps", async ({ isArchived, deletedAt }) => {
    const household = await emptyHousehold();
    const [group] = await db.insert(categoryGroups).values({
      householdId: household.id, name: "My group", type: "expenses",
      displayOrder: 42, budgetMode: "by_group", rolloverEnabled: true, isArchived: true,
    }).returning();
    await db.insert(categories).values({
      householdId: household.id, groupId: group.id, name: "My renamed category",
      icon: "custom", color: "#123456", displayOrder: 73, includeInBudget: false,
      rolloverEnabled: true, rolloverStartBalance: "7.50", isArchived, deletedAt,
    });
    const before = await tree(household.id);
    await seedDefaultCategories(household.id);
    expect(await tree(household.id)).toEqual(before);
  });

  it("rejects a groups-only tree unchanged instead of guessing reconciliation", async () => {
    const household = await emptyHousehold();
    await db.insert(categoryGroups).values({
      householdId: household.id, name: "Existing customized group", type: "expenses",
      displayOrder: 17, isArchived: true,
    });
    const before = await tree(household.id);
    await expect(seedDefaultCategories(household.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await tree(household.id)).toEqual(before);
  });

  it("refuses a missing household without inserting groups or categories", async () => {
    const missingId = randomUUID();
    await expect(seedDefaultCategories(missingId)).rejects.toBeInstanceOf(NotFoundError);
    expect(await tree(missingId)).toEqual({ groups: [], categories: [] });
  });

  it("rolls back standalone groups when the subsequent category insert fails", async () => {
    const household = await emptyHousehold();
    const originalIcon = DEFAULT_CATEGORIES[0].icon;
    let failure: unknown;
    try {
      // A real varchar constraint fails the category batch after group insertion.
      DEFAULT_CATEGORIES[0].icon = "x".repeat(51);
      await seedDefaultCategories(household.id);
    } catch (error) {
      failure = error;
    } finally {
      DEFAULT_CATEGORIES[0].icon = originalIcon;
    }
    expect(failure).toBeDefined();
    expect(await tree(household.id)).toEqual({ groups: [], categories: [] });
    await seedDefaultCategories(household.id);
    await expectExactDefaults(household.id);
  });

  it("rolls back household, membership, tags and groups on mid-seed failure, then permits retry", async () => {
    const owner = await newOwner();
    const name = `r02-rollback-${randomUUID()}`;
    householdNames.push(name);
    const originalIcon = DEFAULT_CATEGORIES[0].icon;
    let failure: unknown;
    try {
      DEFAULT_CATEGORIES[0].icon = "x".repeat(51);
      await householdRepository.createWithOwner({ name, currency: "ZMW", userId: owner.id });
    } catch (error) {
      failure = error;
    } finally {
      DEFAULT_CATEGORIES[0].icon = originalIcon;
    }
    expect(failure).toBeDefined();
    expect(await db.select().from(households).where(eq(households.name, name))).toEqual([]);
    expect(await db.select().from(householdMembers).where(eq(householdMembers.userId, owner.id))).toEqual([]);
    const household = await householdRepository.createWithOwner({ name, currency: "ZMW", userId: owner.id });
    await expectExactDefaults(household.id);
    expect(await db.select().from(tags).where(eq(tags.householdId, household.id))).toHaveLength(8);
  });

  it("serializes concurrent standalone seed calls into one exact set", async () => {
    const household = await emptyHousehold();
    const results = await Promise.allSettled([
      seedDefaultCategories(household.id), seedDefaultCategories(household.id),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    await expectExactDefaults(household.id);
  });

  it("enlists in the supplied transaction so a later caller failure rolls back all defaults", async () => {
    const household = await emptyHousehold();
    const failure = new Error("Synthetic later caller failure");
    await expect(withTransaction(async (tx) => {
      await seedDefaultCategories(household.id, tx);
      throw failure;
    })).rejects.toBe(failure);
    expect(await tree(household.id)).toEqual({ groups: [], categories: [] });
  });

  it("waits for a concurrent FK insert, then preserves the committed custom category", async () => {
    const household = await emptyHousehold();
    let releaseInsert!: () => void;
    let insertReady!: () => void;
    let seedReady!: () => void;
    let insertPid = 0;
    let seedPid = 0;
    const release = new Promise<void>((resolve) => { releaseInsert = resolve; });
    const inserted = new Promise<void>((resolve) => { insertReady = resolve; });
    const seeding = new Promise<void>((resolve) => { seedReady = resolve; });
    const customId = randomUUID();
    const inserting = withTransaction(async (tx) => {
      const pid = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
      insertPid = pid.rows[0].pid;
      // The ordinary FK check holds a KEY SHARE lock on this household.
      await tx.insert(categories).values({
        id: customId, householdId: household.id, name: "Concurrent custom category", displayOrder: 1,
      });
      insertReady();
      await release;
    });
    let seedAttempt: Promise<void> | undefined;
    try {
      await Promise.race([inserted, inserting.then(() => { throw new Error("Insert ended before release"); })]);
      seedAttempt = withTransaction(async (tx) => {
        const pid = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        seedPid = pid.rows[0].pid;
        seedReady();
        await seedDefaultCategories(household.id, tx);
      });
      await Promise.race([seeding, seedAttempt.then(() => {
        throw new Error("Seed attempt ended before announcing its transaction");
      })]);
      let blockedByInsert = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await db.execute<{ blocked: boolean }>(
          sql`SELECT ${insertPid}::int4 = ANY(pg_blocking_pids(${seedPid}::int4)) AS blocked`,
        );
        if (result.rows[0].blocked) {
          blockedByInsert = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blockedByInsert).toBe(true);
    } finally {
      releaseInsert();
      const outcomes = await Promise.allSettled([inserting, ...(seedAttempt ? [seedAttempt] : [])]);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") throw outcome.reason;
      }
    }
    const actual = await tree(household.id);
    expect(actual.groups).toEqual([]);
    expect(actual.categories).toMatchObject([{ id: customId, name: "Concurrent custom category" }]);
    expect(actual.categories).toHaveLength(1);
  });

  it("preserves one-winner same-user creation and commits defaults only for the winner", async () => {
    const owner = await newOwner();
    const names = [`r02-race-a-${randomUUID()}`, `r02-race-b-${randomUUID()}`];
    householdNames.push(...names);
    const results = await Promise.allSettled(names.map((name) =>
      householdRepository.createWithOwner({ name, currency: "ZMW", userId: owner.id })));
    const successes = results.filter((result) => result.status === "fulfilled");
    expect(successes).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected");
    expect(failure?.status === "rejected" ? failure.reason : undefined).toBeInstanceOf(ConflictError);
    if (successes[0].status !== "fulfilled") throw new Error("Missing winning household");
    await expectExactDefaults(successes[0].value.id);
    expect(await db.select().from(householdMembers).where(eq(householdMembers.userId, owner.id)))
      .toHaveLength(1);
  });
});
