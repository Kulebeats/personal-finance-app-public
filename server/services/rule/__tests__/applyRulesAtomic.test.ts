/**
 * SCP-334: applyRules must be ATOMIC — REAL DB.
 *
 * The bug: applyRules scattered its writes across multiple independent
 * transactions/calls (evaluateActions wrote tags + merchant aliases + splits
 * inline, then applyRules updated the transaction, then linked goals), each in
 * its own transaction with per-action errors swallowed. A partial failure left
 * the transaction half-ruled (e.g. tags + splits persisted but the goal link
 * never landed and nothing rolled back).
 *
 * The fix wraps the ENTIRE apply (every matched rule's inline writes, the field
 * update, and the goal links) in ONE withTransaction. A failure anywhere now
 * rolls back the whole apply.
 *
 * These tests seed a transaction plus a rule that does categorize + add_tags +
 * split_transaction + link_goal, then:
 *  1. INJECT a mid-sequence failure at the LAST step (linkTransaction) and
 *     assert FULL rollback: no tag, no split, no field update, no goal link.
 *  2. Run the happy path and assert all four effects persisted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import {
  accounts,
  categories,
  categoryGroups,
  goals,
  households,
  rules,
  tags,
  transactionGoalLinks,
  transactionSplits,
  transactionTags,
  transactions,
  users,
} from "@shared/schema";
import { ruleService } from "../service";
import { transactionGoalLinkService } from "../../TransactionGoalLinkService";
import {
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";

describe("applyRules atomicity (SCP-334)", () => {
  let householdId: string;
  let userId: string;
  let accountId: string;
  let categoryGroupId: string;
  let splitCategoryAId: string;
  let splitCategoryBId: string;
  let renameCategoryId: string;
  let tagId: string;
  let goalId: string;
  let ruleId: string;
  let txnId: string;

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const owner = createTestUser({
      email: `scp334-atomic-${stamp}@example.com`,
      username: `scp334-atomic-${stamp}`,
    });
    const hh = createTestHousehold(owner.id, { name: `scp334-atomic-${stamp}` });
    householdId = hh.id;
    userId = owner.id;

    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
    });

    await db.insert(users).values({
      id: owner.id,
      email: owner.email,
      username: owner.username,
      passwordHash: owner.passwordHash,
      fullName: owner.fullName,
      emailVerified: owner.emailVerified,
      mfaEnabled: owner.mfaEnabled,
      failedLoginAttempts: owner.failedLoginAttempts,
      lockedUntil: owner.lockedUntil,
    });

    const [group] = await db
      .insert(categoryGroups)
      .values({
        householdId,
        name: "Atomic Test Group",
        type: "expenses",
        displayOrder: 1,
      })
      .returning();
    categoryGroupId = group.id;

    const [renameCategory] = await db
      .insert(categories)
      .values({
        householdId,
        groupId: categoryGroupId,
        name: "Reclassified",
        displayOrder: 1,
      })
      .returning();
    renameCategoryId = renameCategory.id;

    const [splitA] = await db
      .insert(categories)
      .values({
        householdId,
        groupId: categoryGroupId,
        name: "Split A",
        displayOrder: 2,
      })
      .returning();
    splitCategoryAId = splitA.id;

    const [splitB] = await db
      .insert(categories)
      .values({
        householdId,
        groupId: categoryGroupId,
        name: "Split B",
        displayOrder: 3,
      })
      .returning();
    splitCategoryBId = splitB.id;

    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "Atomic Account",
      type: "checking",
      balance: "0.00",
      currency: "ZMW",
      isPrivate: false,
    });

    const [tag] = await db
      .insert(tags)
      .values({ householdId, name: "ruletag", usageCount: 0 })
      .returning();
    tagId = tag.id;

    const [goal] = await db
      .insert(goals)
      .values({
        householdId,
        name: "Atomic Goal",
        targetAmount: "1000.00",
        currentAmount: "0.00",
        currency: "ZMW",
        type: "save_up",
      })
      .returning();
    goalId = goal.id;

    // Income transaction (links as a contribution; no special flag needed).
    txnId = randomUUID();
    await db.insert(transactions).values({
      id: txnId,
      householdId,
      accountId,
      ownerUserId: userId,
      date: "2026-01-15",
      name: "Atomic Income",
      amount: "100.00",
      currency: "ZMW",
      type: "income",
      isPrivate: false,
    });

    // One rule, four effects: field update (categorize), inline tag write
    // (add_tags), inline split write (split_transaction), goal link (link_goal).
    ruleId = randomUUID();
    await db.insert(rules).values({
      id: ruleId,
      householdId,
      name: "scp334-atomic-rule",
      priority: 1,
      enabled: true,
      conditions: [{ type: "amount", operator: "greater_than", value: "0" }],
      conditionLogic: "all",
      actions: [
        { type: "categorize", value: renameCategoryId },
        { type: "add_tags", value: [tagId] },
        {
          type: "split_transaction",
          value: "splits",
          splitConfig: [
            { categoryId: splitCategoryAId, percentage: 60, note: "A" },
            { categoryId: splitCategoryBId, percentage: 40, note: "B" },
          ],
        },
        { type: "link_goal", value: goalId },
      ],
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await db
        .delete(transactionGoalLinks)
        .where(eq(transactionGoalLinks.goalId, goalId));
      await db
        .delete(transactionSplits)
        .where(eq(transactionSplits.transactionId, txnId));
      await db
        .delete(transactionTags)
        .where(eq(transactionTags.transactionId, txnId));
      await db.delete(transactions).where(eq(transactions.householdId, householdId));
      await db.delete(rules).where(eq(rules.householdId, householdId));
      await db.delete(goals).where(eq(goals.householdId, householdId));
      await db.delete(tags).where(eq(tags.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(categories).where(eq(categories.householdId, householdId));
      await db
        .delete(categoryGroups)
        .where(eq(categoryGroups.householdId, householdId));
      await db.delete(users).where(eq(users.id, userId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-334 atomic cleanup error", error);
    }
  });

  it("rolls back the WHOLE apply when a late action fails (no partial writes)", async () => {
    // Inject a mid-sequence failure at the final step. By the time the goal
    // link runs, the tag, the splits, and the field update have all already
    // been written inside the transaction — so a throw here must undo them all.
    const spy = vi
      .spyOn(transactionGoalLinkService, "linkTransaction")
      .mockRejectedValueOnce(new Error("injected link failure"));

    const [before] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, txnId));

    await expect(
      ruleService.applyRules(before, householdId, { userId }),
    ).rejects.toThrow("injected link failure");

    expect(spy).toHaveBeenCalledTimes(1);

    // No tag persisted.
    const tagRows = await db
      .select()
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, txnId));
    expect(tagRows.length).toBe(0);

    // Tag usage count not incremented.
    const [tagAfter] = await db.select().from(tags).where(eq(tags.id, tagId));
    expect(tagAfter.usageCount).toBe(0);

    // No splits persisted.
    const splitRows = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, txnId));
    expect(splitRows.length).toBe(0);

    // No goal link persisted.
    const linkRows = await db
      .select()
      .from(transactionGoalLinks)
      .where(eq(transactionGoalLinks.transactionId, txnId));
    expect(linkRows.length).toBe(0);

    // No field update persisted: category, exclusions, and notes unchanged.
    const [txnAfter] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, txnId));
    expect(txnAfter.categoryId).toBeNull();
    expect(txnAfter.isExcludedFromBudget).toBe(false);
    expect(txnAfter.isExcludedFromReports).toBe(false);
    expect(txnAfter.name).toBe("Atomic Income");

    // Goal balance untouched.
    const [goalAfter] = await db.select().from(goals).where(eq(goals.id, goalId));
    expect(goalAfter.currentAmount).toBe("0.00");
  });

  it("persists all effects on the happy path (update + tag + split + goal link)", async () => {
    const [before] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, txnId));

    const result = await ruleService.applyRules(before, householdId, { userId });

    expect(result.categoryId).toBe(renameCategoryId);

    // Tag persisted + usage incremented.
    const tagRows = await db
      .select()
      .from(transactionTags)
      .where(eq(transactionTags.transactionId, txnId));
    expect(tagRows.length).toBe(1);
    expect(tagRows[0].tagId).toBe(tagId);

    const [tagAfter] = await db.select().from(tags).where(eq(tags.id, tagId));
    expect(tagAfter.usageCount).toBe(1);

    // Splits persisted (60 / 40 of 100).
    const splitRows = await db
      .select()
      .from(transactionSplits)
      .where(eq(transactionSplits.transactionId, txnId));
    expect(splitRows.length).toBe(2);
    const amounts = splitRows.map((s) => s.amount).sort();
    expect(amounts).toEqual(["40.00", "60.00"]);

    // Goal link persisted + goal balance updated.
    const linkRows = await db
      .select()
      .from(transactionGoalLinks)
      .where(eq(transactionGoalLinks.transactionId, txnId));
    expect(linkRows.length).toBe(1);
    expect(linkRows[0].goalId).toBe(goalId);

    const [goalAfter] = await db.select().from(goals).where(eq(goals.id, goalId));
    expect(goalAfter.currentAmount).toBe("100.00");

    // Field update persisted: category set, parent remains unflagged. Read
    // paths skip split-parent lumps with NOT EXISTS guards.
    const [txnAfter] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, txnId));
    expect(txnAfter.categoryId).toBe(renameCategoryId);
    expect(txnAfter.isExcludedFromBudget).toBe(false);
    expect(txnAfter.isExcludedFromReports).toBe(false);
  });
});
