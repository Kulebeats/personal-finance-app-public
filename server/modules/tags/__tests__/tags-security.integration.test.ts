/**
 * Tags Security Integration Tests
 *
 * Tests for TAGS-SEC-003: Verify tag household ownership checks
 * before linking/unlinking tags to transactions.
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { getTestApp } from "../../../__tests__/fixtures";
import { db } from "../../../db";
import { tags, transactions, households, users, householdMembers, accounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../../../auth";

describe("Tags Security (TAGS-SEC-003)", () => {
  let app: Express;
  let householdA: any;
  let householdB: any;
  let userA: any;
  let userB: any;
  let tagInHouseholdA: any;
  let tagInHouseholdB: any;
  let transactionInHouseholdA: any;
  let transactionInHouseholdB: any;
  let accountA: any;
  let accountB: any;
  let cookieA: string;
  let cookieB: string;
  let csrfTokenA: string;
  let csrfTokenB: string;

  beforeAll(async () => {
    app = await getTestApp();

    const timestamp = Date.now();
    const passwordHash = await hashPassword("TestPassword123");

    // Create two households
    [householdA] = await db
      .insert(households)
      .values({ name: `Household A ${timestamp}`, currency: "ZMW" })
      .returning();

    [householdB] = await db
      .insert(households)
      .values({ name: `Household B ${timestamp}`, currency: "ZMW" })
      .returning();

    // Create two users
    [userA] = await db
      .insert(users)
      .values({
        email: `usera-${timestamp}@test.com`,
        username: `usera-${timestamp}`,
        passwordHash,
        emailVerified: true,
      })
      .returning();

    [userB] = await db
      .insert(users)
      .values({
        email: `userb-${timestamp}@test.com`,
        username: `userb-${timestamp}`,
        passwordHash,
        emailVerified: true,
      })
      .returning();

    // Add users to their respective households
    await db.insert(householdMembers).values([
      { householdId: householdA.id, userId: userA.id, role: "owner" },
      { householdId: householdB.id, userId: userB.id, role: "owner" },
    ]);

    // Create accounts
    [accountA] = await db
      .insert(accounts)
      .values({
        householdId: householdA.id,
        name: "Account A",
        type: "checking",
        balance: "1000",
        currency: "ZMW",
      })
      .returning();

    [accountB] = await db
      .insert(accounts)
      .values({
        householdId: householdB.id,
        name: "Account B",
        type: "checking",
        balance: "1000",
        currency: "ZMW",
      })
      .returning();

    // Create tags
    [tagInHouseholdA] = await db
      .insert(tags)
      .values({
        householdId: householdA.id,
        name: "Tag A",
        color: "blue",
      })
      .returning();

    [tagInHouseholdB] = await db
      .insert(tags)
      .values({
        householdId: householdB.id,
        name: "Tag B",
        color: "red",
      })
      .returning();

    // Create transactions
    [transactionInHouseholdA] = await db
      .insert(transactions)
      .values({
        householdId: householdA.id,
        accountId: accountA.id,
        date: "2024-01-01",
        name: "Transaction A",
        amount: "100",
        type: "expense",
        ownerUserId: userA.id,
      })
      .returning();

    [transactionInHouseholdB] = await db
      .insert(transactions)
      .values({
        householdId: householdB.id,
        accountId: accountB.id,
        date: "2024-01-01",
        name: "Transaction B",
        amount: "100",
        type: "expense",
        ownerUserId: userB.id,
      })
      .returning();

    // Create authenticated sessions
    const loginResponseA = await request(app)
      .post("/api/auth/login")
      .send({ email: `usera-${timestamp}@test.com`, password: "TestPassword123" })
      .expect(200);
    cookieA = loginResponseA.headers["set-cookie"]
      ? (loginResponseA.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    const loginResponseB = await request(app)
      .post("/api/auth/login")
      .send({ email: `userb-${timestamp}@test.com`, password: "TestPassword123" })
      .expect(200);
    cookieB = loginResponseB.headers["set-cookie"]
      ? (loginResponseB.headers["set-cookie"] as unknown as string[]).join("; ")
      : "";

    // Get CSRF tokens
    const csrfResA = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", cookieA)
      .expect(200);
    csrfTokenA = csrfResA.body.csrfToken;

    const csrfResB = await request(app)
      .get("/api/csrf-token")
      .set("Cookie", cookieB)
      .expect(200);
    csrfTokenB = csrfResB.body.csrfToken;
  });

  afterAll(async () => {
    // Cleanup
    await db.delete(transactions).where(eq(transactions.householdId, householdA.id));
    await db.delete(transactions).where(eq(transactions.householdId, householdB.id));
    await db.delete(tags).where(eq(tags.householdId, householdA.id));
    await db.delete(tags).where(eq(tags.householdId, householdB.id));
    await db.delete(accounts).where(eq(accounts.householdId, householdA.id));
    await db.delete(accounts).where(eq(accounts.householdId, householdB.id));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdA.id));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdB.id));
    await db.delete(households).where(eq(households.id, householdA.id));
    await db.delete(households).where(eq(households.id, householdB.id));
    await db.delete(users).where(eq(users.id, userA.id));
    await db.delete(users).where(eq(users.id, userB.id));
  });

  describe("Add Transaction Tags Security", () => {
    it("should prevent linking tag from another household", async () => {
      const response = await request(app)
        .post(`/api/tags/transaction/${transactionInHouseholdA.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA)
        .send({ tagIds: [tagInHouseholdB.id] }); // Trying to link Household B's tag

      expect(response.status).toBe(404);
    });

    it("should allow linking tag from same household", async () => {
      const response = await request(app)
        .post(`/api/tags/transaction/${transactionInHouseholdA.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA)
        .send({ tagIds: [tagInHouseholdA.id] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.some((tag: any) => tag.id === tagInHouseholdA.id)).toBe(true);
    });
  });

  describe("Remove Transaction Tag Security", () => {
    it("should prevent unlinking tag from another household", async () => {
      const response = await request(app)
        .delete(`/api/tags/transaction/${transactionInHouseholdA.id}/${tagInHouseholdB.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(404);
    });

    it("should allow unlinking tag from same household", async () => {
      const response = await request(app)
        .delete(`/api/tags/transaction/${transactionInHouseholdA.id}/${tagInHouseholdA.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe("Set Transaction Tags Security", () => {
    it("should prevent setting tags with tag from another household", async () => {
      const response = await request(app)
        .put(`/api/tags/transaction/${transactionInHouseholdA.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA)
        .send({ tagIds: [tagInHouseholdA.id, tagInHouseholdB.id] }); // Mix of tags

      expect(response.status).toBe(404);
    });

    it("should allow setting tags all from same household", async () => {
      // Create another tag in household A
      const [tag2] = await db
        .insert(tags)
        .values({
          householdId: householdA.id,
          name: "Tag A2",
          color: "green",
        })
        .returning();

      const response = await request(app)
        .put(`/api/tags/transaction/${transactionInHouseholdA.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA)
        .send({ tagIds: [tagInHouseholdA.id, tag2.id] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(2);

      // Cleanup
      await db.delete(tags).where(eq(tags.id, tag2.id));
    });
  });

  describe("Transaction Visibility + Tag Security", () => {
    it("should prevent tagging another user's private transaction even with valid tag", async () => {
      // Create a private transaction for user A
      const [privateTransaction] = await db
        .insert(transactions)
        .values({
          householdId: householdA.id,
          accountId: accountA.id,
          date: "2024-01-02",
          name: "Private Transaction",
          amount: "50",
          type: "expense",
          ownerUserId: userA.id,
          isPrivate: true,
        })
        .returning();

      // Create another user in same household
      const timestamp2 = Date.now() + 1; // Ensure unique timestamp
      const passwordHash = await hashPassword("TestPassword123");
      const [userA2] = await db
        .insert(users)
        .values({
          email: `usera2-${timestamp2}@test.com`,
          username: `usera2-${timestamp2}`,
          passwordHash,
          emailVerified: true,
        })
        .returning();

      await db.insert(householdMembers).values({
        householdId: householdA.id,
        userId: userA2.id,
        role: "member",
      });

      const loginResponseA2 = await request(app)
        .post("/api/auth/login")
        .send({ email: `usera2-${timestamp2}@test.com`, password: "TestPassword123" })
        .expect(200);
      const cookieA2 = loginResponseA2.headers["set-cookie"]
        ? (loginResponseA2.headers["set-cookie"] as unknown as string[]).join("; ")
        : "";

      // Get CSRF token for userA2
      const csrfResA2 = await request(app)
        .get("/api/csrf-token")
        .set("Cookie", cookieA2)
        .expect(200);
      const csrfTokenA2 = csrfResA2.body.csrfToken;

      // User A2 tries to tag User A's private transaction
      const response = await request(app)
        .post(`/api/tags/transaction/${privateTransaction.id}`)
        .set("Cookie", cookieA2)
        .set("X-CSRF-Token", csrfTokenA2)
        .send({ tagIds: [tagInHouseholdA.id] });

      expect(response.status).toBe(404);

      // Cleanup
      await db.delete(transactions).where(eq(transactions.id, privateTransaction.id));
      await db.delete(householdMembers).where(eq(householdMembers.userId, userA2.id));
      await db.delete(users).where(eq(users.id, userA2.id));
    });
  });
});
