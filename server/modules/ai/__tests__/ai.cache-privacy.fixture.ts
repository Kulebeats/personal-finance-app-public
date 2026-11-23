import { randomUUID } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { eq, inArray, or, sql } from "drizzle-orm";
import {
  accounts,
  aiConversations,
  auditLogs,
  categories,
  goals,
  householdMembers,
  households,
  merchants,
  outboxEvents,
  recurringTransactions,
  securityAuditLogs,
  transactions,
  users,
} from "@shared/schema";
import { db, pool } from "../../../db";
import { createTestUser } from "../../../__tests__/fixtures";
import { recordRecurringDenomination } from "../../../services/recurring/RecurringDenomination";
import { CURRENT_AI_CONSENT_VERSION } from "../ai.consent-policy";

export const password = "SyntheticC308Cache123!";

export function createCachePrivacyFixture() {
  const householdId = randomUUID();
  const foreignHouseholdId = randomUUID();
  const actor = (label: string, memberHouseholdId = householdId) => ({
    ...createTestUser(),
    householdId: memberHouseholdId,
    label,
    cookie: "",
  });

  return {
    householdId,
    foreignHouseholdId,
    owner: actor("owner"),
    member: actor("member"),
    outsider: actor("outsider", foreignHouseholdId),
    date: new Date().toISOString().slice(0, 10),
    sharedAccountId: randomUUID(),
    ownerAccountId: randomUUID(),
    memberAccountId: randomUUID(),
    foreignAccountId: randomUUID(),
    categoryId: randomUUID(),
    foreignCategoryId: randomUUID(),
    merchantId: randomUUID(),
    foreignMerchantId: randomUUID(),
    sharedTransactionId: randomUUID(),
  };
}

export type CachePrivacyFixture = ReturnType<typeof createCachePrivacyFixture>;
export type CachePrivacyActor = CachePrivacyFixture["owner"];

export async function seedCachePrivacyFixture(
  fixture: CachePrivacyFixture,
  app: Express,
  passwordHash: string,
) {
  await db.insert(households).values([
    {
      id: fixture.householdId,
      name: "Synthetic C3-08 members",
      currency: "ZMW",
      aiConsentGiven: true,
      aiConsentDate: new Date(),
      aiConsentVersion: CURRENT_AI_CONSENT_VERSION,
    },
    {
      id: fixture.foreignHouseholdId,
      name: "Synthetic C3-08 other household",
      currency: "ZMW",
      aiConsentGiven: true,
      aiConsentDate: new Date(),
      aiConsentVersion: CURRENT_AI_CONSENT_VERSION,
    },
  ]);

  for (const actor of [fixture.owner, fixture.member, fixture.outsider]) {
    await db.insert(users).values({
      id: actor.id,
      email: actor.email,
      username: actor.username,
      passwordHash,
      emailVerified: true,
      timezone: "Africa/Lusaka",
    });
    await db.insert(householdMembers).values({
      householdId: actor.householdId,
      userId: actor.id,
      role: actor.label === "member" ? "member" : "owner",
    });
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: actor.email, password })
      .expect(200);
    actor.cookie = (login.headers["set-cookie"] as unknown as string[]).join("; ");
  }

  await db.insert(accounts).values([
    {
      id: fixture.sharedAccountId,
      householdId: fixture.householdId,
      name: "C308 SHARED",
      type: "checking",
      currency: "ZMW",
      balance: "988.89",
      isPrivate: false,
      ownerUserId: fixture.owner.id,
    },
    {
      id: fixture.ownerAccountId,
      householdId: fixture.householdId,
      name: "C308 OWNER PRIVATE",
      type: "savings",
      currency: "ZMW",
      balance: "4222.23",
      isPrivate: true,
      ownerUserId: fixture.owner.id,
    },
    {
      id: fixture.memberAccountId,
      householdId: fixture.householdId,
      name: "C308 MEMBER PRIVATE",
      type: "savings",
      currency: "ZMW",
      balance: "633.33",
      isPrivate: true,
      ownerUserId: fixture.member.id,
    },
    {
      id: fixture.foreignAccountId,
      householdId: fixture.foreignHouseholdId,
      name: "C308 FOREIGN",
      type: "checking",
      currency: "ZMW",
      balance: "8888.88",
      isPrivate: false,
      ownerUserId: fixture.outsider.id,
    },
  ]);
  await db.insert(categories).values([
    {
      id: fixture.categoryId,
      householdId: fixture.householdId,
      name: "C308 Household category",
      displayOrder: 0,
    },
    {
      id: fixture.foreignCategoryId,
      householdId: fixture.foreignHouseholdId,
      name: "C308 Foreign category",
      displayOrder: 0,
    },
  ]);
  await db.insert(merchants).values([
    { id: fixture.merchantId, householdId: fixture.householdId, name: "C308 Household store" },
    { id: fixture.foreignMerchantId, householdId: fixture.foreignHouseholdId, name: "C308 Foreign store" },
  ]);
  await db.insert(transactions).values([
    {
      id: fixture.sharedTransactionId,
      householdId: fixture.householdId,
      accountId: fixture.sharedAccountId,
      ownerUserId: fixture.owner.id,
      date: fixture.date,
      name: "C308 Shared expense",
      amount: "11.11",
      currency: "ZMW",
      type: "expense",
      categoryId: fixture.categoryId,
      merchantId: fixture.merchantId,
      isPrivate: false,
    },
    {
      householdId: fixture.householdId,
      accountId: fixture.ownerAccountId,
      ownerUserId: fixture.owner.id,
      date: fixture.date,
      name: "C308 Owner private expense",
      amount: "777.77",
      currency: "ZMW",
      type: "expense",
      categoryId: fixture.categoryId,
      merchantId: fixture.merchantId,
      isPrivate: false,
    },
    {
      householdId: fixture.householdId,
      accountId: fixture.memberAccountId,
      ownerUserId: fixture.member.id,
      date: fixture.date,
      name: "C308 Member private expense",
      amount: "222.22",
      currency: "ZMW",
      type: "expense",
      categoryId: fixture.categoryId,
      merchantId: fixture.merchantId,
      isPrivate: false,
    },
    {
      householdId: fixture.foreignHouseholdId,
      accountId: fixture.foreignAccountId,
      ownerUserId: fixture.outsider.id,
      date: fixture.date,
      name: "C308 Foreign expense",
      amount: "22.22",
      currency: "ZMW",
      type: "expense",
      categoryId: fixture.foreignCategoryId,
      merchantId: fixture.foreignMerchantId,
      isPrivate: false,
    },
  ]);

  // Shared-only goals and recurring rules deliberately avoid certifying the
  // separate cold-reader private-source gaps in these three tool readers.
  for (const foreign of [false, true]) {
    const householdId = foreign ? fixture.foreignHouseholdId : fixture.householdId;
    const accountId = foreign ? fixture.foreignAccountId : fixture.sharedAccountId;
    await db.insert(goals).values({
      householdId,
      name: foreign ? "C308 Foreign goal" : "C308 Shared goal",
      targetAmount: "1000.00",
      currentAmount: foreign ? "44.44" : "207.89",
      linkedAccountId: accountId,
      currency: "ZMW",
    });
    await db.transaction(async tx => {
      const [rule] = await tx.insert(recurringTransactions).values({
        householdId,
        accountId,
        name: foreign ? "C308 Foreign recurring" : "C308 Shared recurring",
        amount: foreign ? "34.56" : "23.45",
        type: "expense",
        frequency: "monthly",
        startDate: fixture.date,
        nextDueDate: fixture.date,
        isActive: true,
      }).returning();
      await recordRecurringDenomination(tx, rule, "ZMW", foreign ? fixture.outsider.id : fixture.owner.id, "manual_creation");
    });
  }
}

export async function cleanCachePrivacyFixture(fixture: CachePrivacyFixture) {
  const householdIds = [fixture.householdId, fixture.foreignHouseholdId];
  const actorIds = [fixture.owner.id, fixture.member.id, fixture.outsider.id];
  await db.delete(auditLogs).where(or(
    inArray(auditLogs.householdId, householdIds),
    inArray(auditLogs.userId, actorIds),
  ));
  await db.delete(securityAuditLogs).where(or(
    inArray(securityAuditLogs.userId, actorIds),
    inArray(securityAuditLogs.targetUserId, actorIds),
  ));
  await db.delete(outboxEvents).where(or(
    inArray(outboxEvents.householdId, householdIds),
    inArray(sql<string>`${outboxEvents.payload}->>'userId'`, actorIds),
  ));
  await db.delete(aiConversations).where(inArray(aiConversations.householdId, householdIds));
  await db.delete(transactions).where(inArray(transactions.householdId, householdIds));
  await db.delete(households).where(inArray(households.id, householdIds));
  for (const actorId of actorIds) {
    await pool.query('DELETE FROM "session" WHERE sess->>\'userId\' = $1', [actorId]);
    await db.delete(users).where(eq(users.id, actorId));
  }
}
