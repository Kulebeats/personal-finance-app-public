/**
 * SCP-334: dryRunRule must enforce transaction visibility — REAL DB.
 *
 * The leak: dryRunRule used transactionRepository.findById (household-scoped only),
 * so any household member could dry-run a rule against ANOTHER member's PRIVATE
 * transaction and read its name/amount/category back in the preview. The fix routes
 * through findByIdWithVisibility, which returns undefined (treated as not-found) for
 * a private transaction the requester does not own.
 *
 * These tests seed a private transaction owned by user A and assert user B cannot
 * see it via dry-run, while the owner still can and shared transactions stay visible.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db } from "../../../db";
import { eq } from "drizzle-orm";
import {
  accounts,
  transactions,
  rules,
  users,
  households,
} from "@shared/schema";
import { ruleService } from "../service";
import {
  createTestUser,
  createTestHousehold,
} from "../../../__tests__/fixtures";

describe("dryRunRule visibility (SCP-334)", () => {
  let householdId: string;
  let ownerId: string;
  let otherMemberId: string;
  let accountId: string;
  let ruleId: string;
  let privateTxnId: string;
  let sharedTxnId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const owner = createTestUser({
      email: `scp334-owner-${stamp}@example.com`,
      username: `scp334-owner-${stamp}`,
    });
    const other = createTestUser({
      email: `scp334-other-${stamp}@example.com`,
      username: `scp334-other-${stamp}`,
    });
    const hh = createTestHousehold(owner.id, { name: `scp334-${stamp}` });
    householdId = hh.id;
    ownerId = owner.id;
    otherMemberId = other.id;

    await db.insert(households).values({
      id: hh.id,
      name: hh.name,
      currency: hh.currency,
    });
    for (const u of [owner, other]) {
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
    }

    accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId,
      name: "Shared Account",
      type: "checking",
      balance: "0.00",
      currency: "ZMW",
      isPrivate: false,
    });

    // A rule that matches any positive amount (action is a no-op write in dry-run).
    ruleId = randomUUID();
    await db.insert(rules).values({
      id: ruleId,
      householdId,
      name: "scp334-rule",
      priority: 1,
      conditions: [{ type: "amount", operator: "greater_than", value: "0" }],
      actions: [{ type: "mark_reviewed", value: true }],
    });

    // Private transaction OWNED BY the owner — must be invisible to other members.
    privateTxnId = randomUUID();
    await db.insert(transactions).values({
      id: privateTxnId,
      householdId,
      accountId,
      ownerUserId: ownerId,
      date: "2026-01-15",
      name: "Confidential Salary",
      amount: "5000.00",
      currency: "ZMW",
      type: "income",
      isPrivate: true,
    });

    // Shared (non-private) transaction — visible to every member.
    sharedTxnId = randomUUID();
    await db.insert(transactions).values({
      id: sharedTxnId,
      householdId,
      accountId,
      ownerUserId: ownerId,
      date: "2026-01-16",
      name: "Groceries",
      amount: "200.00",
      currency: "ZMW",
      type: "expense",
      isPrivate: false,
    });
  });

  afterAll(async () => {
    try {
      await db.delete(transactions).where(eq(transactions.householdId, householdId));
      await db.delete(rules).where(eq(rules.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db.delete(users).where(eq(users.id, ownerId));
      await db.delete(users).where(eq(users.id, otherMemberId));
      await db.delete(households).where(eq(households.id, householdId));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("SCP-334 cleanup error", error);
    }
  });

  it("hides another member's PRIVATE transaction from dry-run (leak closed)", async () => {
    await expect(
      ruleService.dryRunRule(ruleId, privateTxnId, householdId, otherMemberId),
    ).rejects.toThrow("Transaction not found");
  });

  it("lets the OWNER dry-run their own private transaction", async () => {
    const result = await ruleService.dryRunRule(
      ruleId,
      privateTxnId,
      householdId,
      ownerId,
    );
    expect(result.transaction.id).toBe(privateTxnId);
    expect(result.matches).toBe(true);
  });

  it("keeps SHARED transactions visible to other members", async () => {
    const result = await ruleService.dryRunRule(
      ruleId,
      sharedTxnId,
      householdId,
      otherMemberId,
    );
    expect(result.transaction.id).toBe(sharedTxnId);
  });
});
