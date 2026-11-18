/**
 * Rules Bulk Paths - Transaction Privacy (Rule 11) - REAL-DB HTTP Integration Tests
 *
 * Audit gap (reconciliation 2026-07-03 §4b): the rules engine bulk paths bypassed
 * transaction privacy. Create/update with applyToPast and the preview endpoint all
 * fetched via transactionRepository.findByHousehold(householdId) with NO visibility
 * filter, so member A's "apply rules to past transactions" could READ and MUTATE
 * member B's PRIVATE transactions (category/merchant/tags/split). dryRunRule was
 * already fixed (SCP-334); these paths were not.
 *
 * This file proves, against REAL Postgres over REAL HTTP (no mocks), that for two
 * members of one household where member B owns a private transaction matching the
 * rule:
 *   (a) member A's POST /api/rules with applyToPast   -> B's private txn NOT mutated,
 *       while A's own matching txn IS mutated (the rule engine itself works).
 *   (b) member A's POST /api/rules/preview            -> B's private txn NOT returned.
 *   (c) member A's PUT /api/rules/:id with applyToPast -> B's private txn NOT mutated.
 *
 * NODE_ENV=test disables CSRF (see server/app.ts), so only the session cookie is
 * required for the HTTP tests.
 *
 * @module modules/rules/__tests__/rules.privacy.realdb.integration.test
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import {
  users,
  households,
  householdMembers,
  accounts,
  transactions,
  rules,
  categoryGroups,
  categories,
  auditLogs,
} from "@shared/schema";
import {
  getTestApp,
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";
import { randomUUID } from "crypto";

describe("Rules Bulk Paths Privacy REAL-DB Integration (Rule 11)", () => {
  let app: Express;
  let memberACookie: string;
  let householdId: string;
  let memberAId: string;
  let memberBId: string;
  let accountId: string;
  let categoryGroupId: string;
  let categoryId: string;
  let visibleTxnId: string;
  let privateTxnId: string;
  let ruleId: string;

  const timestamp = Date.now();

  beforeAll(async () => {
    app = await getTestApp();

    // --- Household + member A (the caller) ---
    const memberA = createTestUser({
      email: `rules-privacy-a-${timestamp}@example.com`,
      username: `rules-privacy-a-${timestamp}`,
    });
    const testHousehold = createTestHousehold(memberA.id, {
      name: "Rules Privacy Household",
      currency: "ZMW",
    });
    memberA.passwordHash = await hashPassword("TestPassword123");
    householdId = testHousehold.id;
    memberAId = memberA.id;

    await db.insert(households).values({
      id: testHousehold.id,
      name: testHousehold.name,
      currency: testHousehold.currency,
    });
    await db.insert(users).values({
      id: memberA.id,
      email: memberA.email,
      username: memberA.username,
      passwordHash: memberA.passwordHash,
      fullName: memberA.fullName,
      emailVerified: true,
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId: memberA.id,
      role: "owner",
    });

    // --- Member B (owns the private transaction) ---
    const memberB = createTestUser({
      email: `rules-privacy-b-${timestamp}@example.com`,
      username: `rules-privacy-b-${timestamp}`,
    });
    memberBId = memberB.id;
    await db.insert(users).values({
      id: memberB.id,
      email: memberB.email,
      username: memberB.username,
      passwordHash: await hashPassword("MemberPassword123"),
      fullName: memberB.fullName,
      emailVerified: true,
      mfaEnabled: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    await db.insert(householdMembers).values({
      householdId,
      userId: memberB.id,
      role: "member",
    });

    // --- Shared (non-private) account ---
    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "Rules Privacy Checking",
      type: "checking",
      balance: "10000.00",
      currency: "ZMW",
      isAsset: true,
    });

    // --- Category to categorize into ---
    const [group] = await db
      .insert(categoryGroups)
      .values({
        householdId,
        name: "Rules Privacy Expenses",
        type: "expenses",
        displayOrder: 1,
      })
      .returning();
    categoryGroupId = group.id;

    const [category] = await db
      .insert(categories)
      .values({
        groupId: categoryGroupId,
        name: "Rules Privacy Category",
        icon: "coffee",
        color: "#00FF00",
        displayOrder: 1,
      })
      .returning();
    categoryId = category.id;

    // --- Two transactions that BOTH match the rule condition ---
    // One visible to member A, one PRIVATE and owned by member B.
    visibleTxnId = randomUUID();
    privateTxnId = randomUUID();
    await db.insert(transactions).values([
      {
        id: visibleTxnId,
        householdId,
        accountId,
        amount: "45.00",
        type: "expense",
        date: "2026-06-01",
        name: "Coffee Shop Shared",
        ownerUserId: memberAId,
        isPrivate: false,
        categoryId: null,
        currency: "ZMW",
      },
      {
        id: privateTxnId,
        householdId,
        accountId,
        amount: "60.00",
        type: "expense",
        date: "2026-06-02",
        name: "Coffee Shop Private",
        ownerUserId: memberBId,
        isPrivate: true,
        categoryId: null,
        currency: "ZMW",
      },
    ]);

    // Login as member A
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: memberA.email, password: "TestPassword123" })
      .expect(200);
    memberACookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";
  });

  afterAll(async () => {
    try {
      await db.delete(auditLogs).where(eq(auditLogs.householdId, householdId));
      await db.delete(rules).where(eq(rules.householdId, householdId));
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(categories)
        .where(eq(categories.groupId, categoryGroupId));
      await db
        .delete(categoryGroups)
        .where(eq(categoryGroups.id, categoryGroupId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(users).where(eq(users.id, memberAId));
      await db.delete(users).where(eq(users.id, memberBId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Rules privacy cleanup error", error);
    }
  });

  it("POST /api/rules with applyToPast does not mutate another member's private transaction", async () => {
    const res = await request(app)
      .post("/api/rules")
      .set("Cookie", memberACookie)
      .send({
        name: "Categorize coffee (privacy test)",
        conditions: [
          { type: "merchant_name", operator: "contains", value: "Coffee" },
        ],
        conditionLogic: "all",
        actions: [{ type: "categorize", value: categoryId }],
        applyToPast: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    ruleId = res.body.data.rule.id;

    const persisted = await db
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(eq(transactions.householdId, householdId));
    const byId = new Map(persisted.map((t) => [t.id, t.categoryId]));

    // The rule engine ran: member A's own matching transaction was categorized.
    expect(byId.get(visibleTxnId)).toBe(categoryId);
    // Member B's PRIVATE transaction was neither read nor mutated.
    expect(byId.get(privateTxnId)).toBeNull();
  });

  it("POST /api/rules/preview does not return another member's private transaction", async () => {
    const res = await request(app)
      .post("/api/rules/preview")
      .set("Cookie", memberACookie)
      .send({
        conditions: [
          { type: "merchant_name", operator: "contains", value: "Coffee" },
        ],
        conditionLogic: "all",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const returnedIds = (
      res.body.data.matchingTransactions as Array<{ id: string }>
    ).map((t) => t.id);
    expect(returnedIds).toContain(visibleTxnId);
    expect(returnedIds).not.toContain(privateTxnId);
  });

  it("PUT /api/rules/:id with applyToPast does not mutate another member's private transaction", async () => {
    // Reset the visible transaction so the re-apply is observable.
    await db
      .update(transactions)
      .set({ categoryId: null })
      .where(eq(transactions.id, visibleTxnId));

    const res = await request(app)
      .put(`/api/rules/${ruleId}`)
      .set("Cookie", memberACookie)
      .send({ applyToPast: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const persisted = await db
      .select({ id: transactions.id, categoryId: transactions.categoryId })
      .from(transactions)
      .where(eq(transactions.householdId, householdId));
    const byId = new Map(persisted.map((t) => [t.id, t.categoryId]));

    expect(byId.get(visibleTxnId)).toBe(categoryId);
    expect(byId.get(privateTxnId)).toBeNull();
  });
});
