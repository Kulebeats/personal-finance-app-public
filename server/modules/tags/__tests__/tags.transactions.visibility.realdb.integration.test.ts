/**
 * Tags transaction visibility REAL-DB integration tests (W2)
 *
 * Exercises GET /api/tags/:id/transactions over real HTTP and real Postgres.
 * The endpoint must apply private-transaction visibility before limit/offset
 * pagination so a household tag cannot leak another member's private rows.
 */

import request from "supertest";
import { randomUUID } from "crypto";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../../db";
import {
  accounts,
  householdMembers,
  households,
  tags,
  transactionTags,
  transactions,
  users,
} from "@shared/schema";
import {
  createTestHousehold,
  createTestUser,
  getTestApp,
} from "../../../__tests__/fixtures";
import { hashPassword } from "../../../auth";

interface SeededMember {
  householdId: string;
  userId: string;
  email: string;
  cookie: string;
}

interface SeededScenario {
  householdId: string;
  accountId: string;
  tagId: string;
  owner: SeededMember;
  viewer: SeededMember;
  ownerPrivateId: string;
  viewerPrivateId: string;
  sharedLatestId: string;
  sharedOlderId: string;
}

describe("Tags transaction visibility REAL-DB integration (W2)", () => {
  let app: Express;
  const trackedHouseholdIds = new Set<string>();
  const trackedUserIds = new Set<string>();

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterEach(async () => {
    for (const householdId of trackedHouseholdIds) {
      const householdTransactions = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(eq(transactions.householdId, householdId));
      const householdTransactionIds = householdTransactions.map(
        (transaction) => transaction.id,
      );

      if (householdTransactionIds.length > 0) {
        await db
          .delete(transactionTags)
          .where(inArray(transactionTags.transactionId, householdTransactionIds));
      }
      await db
        .delete(transactions)
        .where(eq(transactions.householdId, householdId));
      await db.delete(tags).where(eq(tags.householdId, householdId));
      await db.delete(accounts).where(eq(accounts.householdId, householdId));
      await db
        .delete(householdMembers)
        .where(eq(householdMembers.householdId, householdId));
      await db.delete(households).where(eq(households.id, householdId));
    }

    for (const userId of trackedUserIds) {
      await db.delete(users).where(eq(users.id, userId));
    }

    trackedHouseholdIds.clear();
    trackedUserIds.clear();
  });

  async function seedMember(options: {
    householdId: string;
    role?: "owner" | "admin" | "member";
    emailPrefix: string;
  }): Promise<SeededMember> {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const user = createTestUser({
      email: `${options.emailPrefix}-${stamp}@example.com`,
      username: `${options.emailPrefix}-${stamp}`,
    });
    user.passwordHash = await hashPassword("TestPassword123");
    trackedUserIds.add(user.id);

    await db.insert(users).values({
      id: user.id,
      email: user.email,
      username: user.username,
      passwordHash: user.passwordHash,
      fullName: user.fullName,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
    });
    await db.insert(householdMembers).values({
      householdId: options.householdId,
      userId: user.id,
      role: options.role ?? "member",
    });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "TestPassword123" })
      .expect(200);
    const cookie = loginRes.headers["set-cookie"]
      ? (loginRes.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    return {
      householdId: options.householdId,
      userId: user.id,
      email: user.email,
      cookie,
    };
  }

  async function seedScenario(): Promise<SeededScenario> {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const household = createTestHousehold("seed", {
      name: `Tags W2 ${stamp}`,
      currency: "ZMW",
    });
    trackedHouseholdIds.add(household.id);

    await db.insert(households).values({
      id: household.id,
      name: household.name,
      currency: household.currency,
    });

    const owner = await seedMember({
      householdId: household.id,
      role: "owner",
      emailPrefix: "tags-w2-owner",
    });
    const viewer = await seedMember({
      householdId: household.id,
      role: "member",
      emailPrefix: "tags-w2-viewer",
    });

    const accountId = randomUUID();
    await db.insert(accounts).values({
      id: accountId,
      householdId: household.id,
      name: `Tags W2 Account ${stamp}`,
      type: "checking",
      balance: "1000.00",
      initialBalance: "1000.00",
      currency: "ZMW",
      isAsset: true,
    });

    const [tag] = await db
      .insert(tags)
      .values({
        householdId: household.id,
        name: `W2 Tag ${stamp}`,
        color: "#3366FF",
      })
      .returning();

    const transactionRows = await db
      .insert(transactions)
      .values([
        {
          householdId: household.id,
          accountId,
          date: "2026-02-04",
          name: "owner private tagged transaction",
          amount: "44.00",
          type: "expense",
          ownerUserId: owner.userId,
          isPrivate: true,
        },
        {
          householdId: household.id,
          accountId,
          date: "2026-02-03",
          name: "shared latest tagged transaction",
          amount: "33.00",
          type: "expense",
          ownerUserId: owner.userId,
          isPrivate: false,
        },
        {
          householdId: household.id,
          accountId,
          date: "2026-02-02",
          name: "shared older tagged transaction",
          amount: "22.00",
          type: "expense",
          ownerUserId: viewer.userId,
          isPrivate: false,
        },
        {
          householdId: household.id,
          accountId,
          date: "2026-02-01",
          name: "viewer private tagged transaction",
          amount: "11.00",
          type: "expense",
          ownerUserId: viewer.userId,
          isPrivate: true,
        },
      ])
      .returning();

    await db.insert(transactionTags).values(
      transactionRows.map((transaction) => ({
        transactionId: transaction.id,
        tagId: tag.id,
      })),
    );

    return {
      householdId: household.id,
      accountId,
      tagId: tag.id,
      owner,
      viewer,
      ownerPrivateId: transactionRows[0].id,
      sharedLatestId: transactionRows[1].id,
      sharedOlderId: transactionRows[2].id,
      viewerPrivateId: transactionRows[3].id,
    };
  }

  it("filters private tagged transactions before applying limit and offset", async () => {
    const scenario = await seedScenario();

    const viewerPage = await request(app)
      .get(`/api/tags/${scenario.tagId}/transactions?limit=1&offset=1`)
      .set("Cookie", scenario.viewer.cookie)
      .expect(200);

    expect(viewerPage.body.success).toBe(true);
    expect(viewerPage.body.data.count).toBe(3);
    expect(viewerPage.body.data.transactions.map((tx: { id: string }) => tx.id))
      .toEqual([scenario.sharedOlderId]);

    const ownerPage = await request(app)
      .get(`/api/tags/${scenario.tagId}/transactions?limit=10`)
      .set("Cookie", scenario.owner.cookie)
      .expect(200);

    expect(ownerPage.body.data.count).toBe(3);
    expect(ownerPage.body.data.transactions.map((tx: { id: string }) => tx.id))
      .toEqual([
        scenario.ownerPrivateId,
        scenario.sharedLatestId,
        scenario.sharedOlderId,
      ]);
    expect(
      ownerPage.body.data.transactions.some(
        (tx: { id: string }) => tx.id === scenario.viewerPrivateId,
      ),
    ).toBe(false);
  });
});
