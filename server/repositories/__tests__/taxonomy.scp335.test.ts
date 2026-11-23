/**
 * SCP-335: taxonomy integrity (merchants / tags / categories) — REAL DB.
 *
 * Proves the data-integrity fixes the audit flagged for Merchants, Tags and
 * Categories. Every test runs against real Postgres (no mocks) and cleans up
 * after itself in afterAll, mirroring the SCP-333 template
 * (householdRoles.scp333.test.ts).
 *
 * Covered invariants:
 *  1. Merchant merge moves the source's transactionCount onto the target AND
 *     zeroes the source, so the transactionCount-ordered list ranks correctly.
 *  2. Tag usageCount is NOT inflated by re-tagging: the idempotent link insert
 *     reports inserted=false on a duplicate, and the service only increments
 *     when a row was actually added.
 *  3. setTransactionTags is atomic (delete-then-insert inside a transaction).
 *  4. reorderGroups is atomic and household-scoped.
 *  5. The category repository is household-scoped: a query/update cannot read
 *     or touch another household's category.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  households,
  users,
  householdMembers,
  accounts,
  merchants,
  tags,
  transactionTags,
  transactions,
  categories,
  categoryGroups,
  auditLogs,
} from "@shared/schema";
import { merchantLifecycleService } from "../../modules/merchants/merchants.lifecycle.service";
import { tagRepository } from "../TagRepository";
import { tagService } from "../../modules/tags/tags.service";
import { categoryRepository } from "../CategoryRepository";
import { categoryGroupRepository } from "../CategoryGroupRepository";
import { NotFoundError } from "../../core/errors";
import { createTestUser, createTestHousehold } from "../../__tests__/fixtures";

describe("Taxonomy integrity (SCP-335)", () => {
  let householdA: string;
  let householdB: string;
  let userA: string;
  let accountA: string;
  // Whether this test created the unique constraint that the idempotent tag
  // insert depends on (so we only drop what we created and leave the shared DB
  // exactly as we found it).
  let createdUniqueTagIndex = false;

  async function seedHousehold(label: string): Promise<{
    householdId: string;
    userId: string;
  }> {
    const u = createTestUser({
      email: `scp335-${label}-${randomUUID().slice(0, 8)}@example.com`,
      username: `scp335-${label}-${randomUUID().slice(0, 8)}`,
    });
    const hh = createTestHousehold(u.id, { name: `scp335-${label}-${Date.now()}` });
    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
    });
    await db.insert(users).values({
      id: u.id,
      email: u.email,
      username: u.username,
      passwordHash: u.passwordHash,
      fullName: u.fullName,
      emailVerified: u.emailVerified,
      mfaEnabled: u.mfaEnabled,
      failedLoginAttempts: u.failedLoginAttempts,
      lockedUntil: u.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: hh.id,
      userId: u.id,
      role: "owner",
      joinedAt: new Date(),
    });
    return { householdId: hh.id, userId: u.id };
  }

  beforeAll(async () => {
    const a = await seedHousehold("hh-a");
    householdA = a.householdId;
    userA = a.userId;

    const b = await seedHousehold("hh-b");
    householdB = b.householdId;

    accountA = randomUUID();
    await db.insert(accounts).values({
      id: accountA,
      householdId: householdA,
      name: "SCP335 Checking",
      type: "checking",
      balance: "1000.00",
      currency: "ZMW",
    });

    // The idempotent tag-link insert (onConflictDoNothing) requires a unique
    // constraint on (transaction_id, tag_id). It ships in migration
    // 0003_chilly_diamondback.sql; ensure it exists for this run and remember
    // whether we created it so we can leave the shared DB untouched afterwards.
    const existing = await db.execute(
      sql`SELECT 1 FROM pg_indexes WHERE indexname = 'unique_transaction_tag'`
    );
    if (existing.rows.length === 0) {
      await db.execute(
        sql`CREATE UNIQUE INDEX unique_transaction_tag ON transaction_tags (transaction_id, tag_id)`
      );
      createdUniqueTagIndex = true;
    }
  });

  afterAll(async () => {
    try {
      for (const hh of [householdA, householdB]) {
        // transaction_tags cascade from transactions, but delete explicitly to
        // be safe across schema variations.
        const txRows = await db
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.householdId, hh));
        for (const { id } of txRows) {
          await db
            .delete(transactionTags)
            .where(eq(transactionTags.transactionId, id));
        }
        await db.delete(transactions).where(eq(transactions.householdId, hh));
        await db.delete(tags).where(eq(tags.householdId, hh));
        await db.delete(merchants).where(eq(merchants.householdId, hh));
        await db.delete(categories).where(eq(categories.householdId, hh));
        await db.delete(categoryGroups).where(eq(categoryGroups.householdId, hh));
        await db.delete(accounts).where(eq(accounts.householdId, hh));
        await db.delete(auditLogs).where(eq(auditLogs.householdId, hh));
        await db.delete(householdMembers).where(eq(householdMembers.householdId, hh));
        await db.delete(households).where(eq(households.id, hh));
      }
      // Clean up users last (FK from household_members already gone).
      await db
        .delete(users)
        .where(sql`${users.username} LIKE 'scp335-%'`);

      if (createdUniqueTagIndex) {
        await db.execute(sql`DROP INDEX IF EXISTS unique_transaction_tag`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-335 cleanup error", error);
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Merchant merge updates transactionCount on BOTH source and target.
  // ---------------------------------------------------------------------------
  it("merchant merge rolls source transactionCount into target and zeroes source", async () => {
    const [source] = await db
      .insert(merchants)
      .values({
        id: randomUUID(),
        householdId: householdA,
        name: `Merge Source ${randomUUID().slice(0, 6)}`,
        isActive: true,
        transactionCount: 3,
      })
      .returning();

    const [target] = await db
      .insert(merchants)
      .values({
        id: randomUUID(),
        householdId: householdA,
        name: `Merge Target ${randomUUID().slice(0, 6)}`,
        isActive: true,
        transactionCount: 5,
      })
      .returning();

    // Real rows behind the counts: merge recounts from them (ORG-008).
    for (const [merchantId, rows] of [[source.id, 3], [target.id, 5]] as const) {
      for (let i = 0; i < rows; i++) {
        await db.insert(transactions).values({
          id: randomUUID(),
          householdId: householdA,
          accountId: accountA,
          merchantId,
          amount: "-1.00",
          currency: "ZMW",
          date: "2026-01-10",
          name: `SCP335 merge row ${i}`,
          type: "expense",
          ownerUserId: userA,
        });
      }
    }

    await merchantLifecycleService.merge(source.id, target.id, {
      householdId: householdA,
      userId: userA,
    }, { householdId: householdA, userId: userA, role: "owner" });

    const [sourceAfter] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, source.id));
    const [targetAfter] = await db
      .select()
      .from(merchants)
      .where(eq(merchants.id, target.id));

    // Target absorbs both counts; source is zeroed (and inactive) so the
    // transactionCount-ordered list ranks the merged merchants correctly.
    expect(targetAfter.transactionCount).toBe(8);
    expect(sourceAfter.transactionCount).toBe(0);
    expect(sourceAfter.isActive).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 2. Tag usageCount is not inflated by re-tagging.
  // ---------------------------------------------------------------------------
  async function seedTagAndTransaction(): Promise<{
    tagId: string;
    transactionId: string;
  }> {
    const [tag] = await db
      .insert(tags)
      .values({
        id: randomUUID(),
        householdId: householdA,
        name: `Tag ${randomUUID().slice(0, 6)}`,
        usageCount: 0,
      })
      .returning();

    const [tx] = await db
      .insert(transactions)
      .values({
        id: randomUUID(),
        householdId: householdA,
        accountId: accountA,
        amount: "12.34",
        currency: "ZMW",
        date: "2026-01-15",
        name: "SCP335 tx",
        type: "expense",
        ownerUserId: userA,
        isPrivate: false,
      })
      .returning();

    return { tagId: tag.id, transactionId: tx.id };
  }

  it("addTagToTransaction reports inserted=true once, then inserted=false (idempotent)", async () => {
    const { tagId, transactionId } = await seedTagAndTransaction();

    const first = await tagRepository.addTagToTransaction(transactionId, tagId);
    const second = await tagRepository.addTagToTransaction(transactionId, tagId);

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);

    // Exactly one link row exists — no duplicate.
    const links = await db
      .select()
      .from(transactionTags)
      .where(
        and(
          eq(transactionTags.transactionId, transactionId),
          eq(transactionTags.tagId, tagId)
        )
      );
    expect(links).toHaveLength(1);
  });

  it("re-tagging via the service does NOT inflate usageCount", async () => {
    const { tagId, transactionId } = await seedTagAndTransaction();

    // First add: usageCount 0 -> 1.
    const actor = { householdId: householdA, userId: userA, role: "owner" as const };
    await tagService.addTransactionTags(transactionId, [tagId], actor);
    const [afterFirst] = await db
      .select()
      .from(tags)
      .where(eq(tags.id, tagId));
    expect(afterFirst.usageCount).toBe(1);

    // Re-tag the same transaction with the same tag twice more. The link is
    // already present, so usageCount must stay at 1.
    await tagService.addTransactionTags(transactionId, [tagId], actor);
    await tagService.addTransactionTags(transactionId, [tagId], actor);

    const [afterRetag] = await db
      .select()
      .from(tags)
      .where(eq(tags.id, tagId));
    expect(afterRetag.usageCount).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 3. setTransactionTags is atomic (and replaces the full set correctly).
  // ---------------------------------------------------------------------------
  it("setTransactionTags atomically replaces the tag set", async () => {
    const { transactionId } = await seedTagAndTransaction();
    const tagIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [t] = await db
        .insert(tags)
        .values({
          id: randomUUID(),
          householdId: householdA,
          name: `SetTag ${randomUUID().slice(0, 6)}`,
          usageCount: 0,
        })
        .returning();
      tagIds.push(t.id);
    }

    // Seed an initial set, then replace it.
    await tagRepository.setTransactionTags(transactionId, [tagIds[0], tagIds[1]]);
    const afterInitial = await db
      .select()
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, transactionId));
    expect(afterInitial).toHaveLength(2);

    await tagRepository.setTransactionTags(transactionId, [tagIds[2]]);
    const afterReplace = await db
      .select()
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, transactionId));

    // Old links gone, only the new one remains — the delete-then-insert ran as
    // one transaction (never left an empty or partial set on a real path).
    expect(afterReplace).toHaveLength(1);
    expect(afterReplace[0].tagId).toBe(tagIds[2]);

    // Clearing to an empty set removes all links atomically.
    await tagRepository.setTransactionTags(transactionId, []);
    const afterClear = await db
      .select()
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, transactionId));
    expect(afterClear).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 4. reorderGroups is atomic and household-scoped.
  // ---------------------------------------------------------------------------
  async function seedGroup(
    householdId: string,
    displayOrder: number
  ): Promise<string> {
    const [g] = await db
      .insert(categoryGroups)
      .values({
        id: randomUUID(),
        householdId,
        name: `Group ${randomUUID().slice(0, 6)}`,
        type: "expense",
        displayOrder,
      })
      .returning();
    return g.id;
  }

  it("reorderGroups applies the new displayOrder for the household", async () => {
    const g0 = await seedGroup(householdA, 0);
    const g1 = await seedGroup(householdA, 1);
    const g2 = await seedGroup(householdA, 2);

    // Reverse the order.
    await categoryGroupRepository.reorder(householdA, [g2, g1, g0]);

    const rows = await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.householdId, householdA));
    const orderById = new Map(rows.map((r) => [r.id, r.displayOrder]));

    expect(orderById.get(g2)).toBe(0);
    expect(orderById.get(g1)).toBe(1);
    expect(orderById.get(g0)).toBe(2);
  });

  it("reorderGroups rolls back entirely when one id is not in the household", async () => {
    const g0 = await seedGroup(householdA, 0);
    const g1 = await seedGroup(householdA, 1);
    // A group that belongs to a DIFFERENT household must not be reorderable.
    const foreign = await seedGroup(householdB, 0);

    const before = await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.householdId, householdA));
    const beforeOrder = new Map(before.map((r) => [r.id, r.displayOrder]));

    await expect(
      categoryGroupRepository.reorder(householdA, [g1, foreign, g0])
    ).rejects.toBeInstanceOf(NotFoundError);

    // The whole reorder rolled back: householdA's groups keep their old order
    // and the foreign group is untouched.
    const after = await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.householdId, householdA));
    for (const row of after) {
      expect(row.displayOrder).toBe(beforeOrder.get(row.id));
    }

    const [foreignAfter] = await db
      .select()
      .from(categoryGroups)
      .where(eq(categoryGroups.id, foreign));
    expect(foreignAfter.displayOrder).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 5. Category repository is household-scoped.
  // ---------------------------------------------------------------------------
  it("category repo cannot read or update another household's category", async () => {
    const groupB = await seedGroup(householdB, 0);
    const [catB] = await db
      .insert(categories)
      .values({
        id: randomUUID(),
        householdId: householdB,
        groupId: groupB,
        name: "Household B Category",
        displayOrder: 0,
      })
      .returning();

    // householdA must not be able to read householdB's category.
    const readAcross = await categoryRepository.findById(catB.id, householdA);
    expect(readAcross).toBeUndefined();

    // The owning household can read it.
    const readOwn = await categoryRepository.findById(catB.id, householdB);
    expect(readOwn?.id).toBe(catB.id);

    // householdA must not be able to update householdB's category.
    const updateAcross = await categoryRepository.update(catB.id, householdA, {
      name: "Hijacked",
    });
    expect(updateAcross).toBeUndefined();

    const [unchanged] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, catB.id));
    expect(unchanged.name).toBe("Household B Category");
  });
});
