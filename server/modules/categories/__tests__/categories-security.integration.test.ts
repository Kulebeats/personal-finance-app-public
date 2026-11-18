/**
 * Categories Security Integration Tests
 *
 * Tests for SEC-CRITICAL-003: Verify household ownership checks
 * on category mutations (update, delete, restore).
 */

import request from "supertest";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express } from "express";
import { getTestApp } from "../../../__tests__/fixtures";
import { db } from "../../../db";
import { categories, categoryGroups, households, users, householdMembers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../../../auth";

describe("Categories Security (SEC-CRITICAL-003)", () => {
  let app: Express;
  let householdA: any;
  let householdB: any;
  let userA: any;
  let userB: any;
  let categoryInHouseholdA: any;
  let categoryInHouseholdB: any;
  let groupInHouseholdA: any;
  let groupInHouseholdB: any;
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

    // Create category groups
    [groupInHouseholdA] = await db
      .insert(categoryGroups)
      .values({
        householdId: householdA.id,
        name: "Group A",
        type: "expense",
        displayOrder: 1,
      })
      .returning();

    [groupInHouseholdB] = await db
      .insert(categoryGroups)
      .values({
        householdId: householdB.id,
        name: "Group B",
        type: "expense",
        displayOrder: 1,
      })
      .returning();

    // Create categories
    [categoryInHouseholdA] = await db
      .insert(categories)
      .values({
        householdId: householdA.id,
        groupId: groupInHouseholdA.id,
        name: "Category A",
        displayOrder: 1,
      })
      .returning();

    [categoryInHouseholdB] = await db
      .insert(categories)
      .values({
        householdId: householdB.id,
        groupId: groupInHouseholdB.id,
        name: "Category B",
        displayOrder: 1,
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
    await db.delete(categories).where(eq(categories.householdId, householdA.id));
    await db.delete(categories).where(eq(categories.householdId, householdB.id));
    await db.delete(categoryGroups).where(eq(categoryGroups.householdId, householdA.id));
    await db.delete(categoryGroups).where(eq(categoryGroups.householdId, householdB.id));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdA.id));
    await db.delete(householdMembers).where(eq(householdMembers.householdId, householdB.id));
    await db.delete(households).where(eq(households.id, householdA.id));
    await db.delete(households).where(eq(households.id, householdB.id));
    await db.delete(users).where(eq(users.id, userA.id));
    await db.delete(users).where(eq(users.id, userB.id));
  });

  describe("Category Update Security", () => {
    it("should prevent cross-household category update", async () => {
      const response = await request(app)
        .put(`/api/categories/${categoryInHouseholdB.id}`)
        .set("Cookie", cookieA) // User A trying to modify Household B's category
        .set("X-CSRF-Token", csrfTokenA)
        .send({ name: "Malicious Update" });

      expect(response.status).toBe(404);

      // Verify category was not modified
      const [unchanged] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, categoryInHouseholdB.id))
        .limit(1);

      expect(unchanged.name).toBe("Category B");
    });

    it("should allow same-household category update", async () => {
      const response = await request(app)
        .put(`/api/categories/${categoryInHouseholdA.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA)
        .send({ name: "Updated Category A" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.category.name).toBe("Updated Category A");
    });
  });

  describe("Category Delete Security", () => {
    it("should prevent cross-household category delete", async () => {
      const response = await request(app)
        .delete(`/api/categories/${categoryInHouseholdB.id}`)
        .set("Cookie", cookieA) // User A trying to delete Household B's category
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(404);

      // Verify category was not deleted
      const [unchanged] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, categoryInHouseholdB.id))
        .limit(1);

      expect(unchanged).toBeDefined();
      expect(unchanged.isArchived).toBe(false);
    });

    it("should allow same-household category delete", async () => {
      const response = await request(app)
        .delete(`/api/categories/${categoryInHouseholdA.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.category.isArchived).toBe(true);
    });
  });

  describe("Category Restore Security", () => {
    it("should prevent cross-household category restore", async () => {
      // First, archive a category in household B
      await db
        .update(categories)
        .set({ isArchived: true })
        .where(eq(categories.id, categoryInHouseholdB.id));

      const response = await request(app)
        .put(`/api/categories/${categoryInHouseholdB.id}/restore`)
        .set("Cookie", cookieA) // User A trying to restore Household B's category
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(404);

      // Verify category was not restored
      const [unchanged] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, categoryInHouseholdB.id))
        .limit(1);

      expect(unchanged.isArchived).toBe(true);
    });

    it("should allow same-household category restore", async () => {
      // Create a fresh category and archive it for this test
      const [testCategory] = await db
        .insert(categories)
        .values({
          householdId: householdA.id,
          groupId: groupInHouseholdA.id,
          name: "Test Category for Restore",
          displayOrder: 99,
          isArchived: true,
        })
        .returning();

      const response = await request(app)
        .put(`/api/categories/${testCategory.id}/restore`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.category.isArchived).toBe(false);

      // Cleanup
      await db.delete(categories).where(eq(categories.id, testCategory.id));
    });
  });

  describe("Category Group Update Security", () => {
    it("should prevent cross-household group update", async () => {
      const response = await request(app)
        .put(`/api/categories/groups/${groupInHouseholdB.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA)
        .send({ name: "Malicious Group Update" });

      expect(response.status).toBe(404);

      const [unchanged] = await db
        .select()
        .from(categoryGroups)
        .where(eq(categoryGroups.id, groupInHouseholdB.id))
        .limit(1);

      expect(unchanged.name).toBe("Group B");
    });

    it("should allow same-household group update", async () => {
      const [testGroup] = await db
        .insert(categoryGroups)
        .values({
          householdId: householdA.id,
          name: "Group Update Same Household",
          type: "expense",
          displayOrder: 101,
        })
        .returning();

      const response = await request(app)
        .put(`/api/categories/groups/${testGroup.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA)
        .send({ name: "Updated Group Same Household" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.group.name).toBe("Updated Group Same Household");

      await db.delete(categoryGroups).where(eq(categoryGroups.id, testGroup.id));
    });
  });

  describe("Category Group Delete Security", () => {
    it("should prevent cross-household group delete", async () => {
      const response = await request(app)
        .delete(`/api/categories/groups/${groupInHouseholdB.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(404);

      const [unchanged] = await db
        .select()
        .from(categoryGroups)
        .where(eq(categoryGroups.id, groupInHouseholdB.id))
        .limit(1);

      expect(unchanged).toBeDefined();
      expect(unchanged.isArchived).toBe(false);
    });

    it("should allow same-household group delete", async () => {
      const [testGroup] = await db
        .insert(categoryGroups)
        .values({
          householdId: householdA.id,
          name: "Group Delete Same Household",
          type: "expense",
          displayOrder: 102,
        })
        .returning();

      const response = await request(app)
        .delete(`/api/categories/groups/${testGroup.id}`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.group.isArchived).toBe(true);

      await db.delete(categoryGroups).where(eq(categoryGroups.id, testGroup.id));
    });
  });

  describe("Category Group Restore Security", () => {
    it("should prevent cross-household group restore", async () => {
      await db
        .update(categoryGroups)
        .set({ isArchived: true })
        .where(eq(categoryGroups.id, groupInHouseholdB.id));

      const response = await request(app)
        .put(`/api/categories/groups/${groupInHouseholdB.id}/restore`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(404);

      const [unchanged] = await db
        .select()
        .from(categoryGroups)
        .where(eq(categoryGroups.id, groupInHouseholdB.id))
        .limit(1);

      expect(unchanged.isArchived).toBe(true);
    });

    it("should allow same-household group restore", async () => {
      const [testGroup] = await db
        .insert(categoryGroups)
        .values({
          householdId: householdA.id,
          name: "Group Restore Same Household",
          type: "expense",
          displayOrder: 103,
          isArchived: true,
        })
        .returning();

      const response = await request(app)
        .put(`/api/categories/groups/${testGroup.id}/restore`)
        .set("Cookie", cookieA)
        .set("X-CSRF-Token", csrfTokenA);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.group.isArchived).toBe(false);

      await db.delete(categoryGroups).where(eq(categoryGroups.id, testGroup.id));
    });
  });
});
