/**
 * HouseholdRepository Tests
 *
 * Comprehensive tests for HouseholdRepository including:
 * - CRUD operations
 * - Member management
 * - Invitation management
 * - Edge cases (EDGE-004 to EDGE-008)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { inArray } from "drizzle-orm";
import { householdRepository } from "../HouseholdRepository";
import { userRepository } from "../UserRepository";
import { db } from "../../db";
import { households, householdMembers, householdInvitations, users } from "@shared/schema";
import { ConflictError } from "../../utils/errorHandler";
import crypto from "crypto";

// P8b (test-isolation flake): this suite used to tear down with UNSCOPED
// `db.delete(households)` / `db.delete(users)` in `afterEach` — wiping the
// ENTIRE households/users tables after every one of this file's ~20 tests,
// not just the rows it created. Under full-suite/parallel execution against
// a shared Postgres instance, that blind delete raced with (and deleted) rows
// another concurrently-running suite — e.g.
// server/services/budget/__tests__/budgetRecalc.atomicity.test.ts — was still
// using, producing an FK violation on `households` there. No budget code was
// at fault; this file's teardown scope was the bug. Fix: track every
// household/user this file creates (including the extra ones a few tests
// create beyond the shared beforeEach fixtures) and scope every delete to
// exactly those ids.
describe("HouseholdRepository", () => {
  let testUserId: string;
  let testUserId2: string;
  let testHouseholdId: string;
  let extraHouseholdIds: string[];
  let extraUserIds: string[];

  beforeEach(async () => {
    extraHouseholdIds = [];
    extraUserIds = [];

    // Create test users
    const user1 = await db
      .insert(users)
      .values({
        email: `test-${crypto.randomUUID()}@example.com`,
        username: `u-${crypto.randomUUID()}`,
        passwordHash: "hash",
        fullName: "Test User 1",
      })
      .returning();
    testUserId = user1[0].id;

    const user2 = await db
      .insert(users)
      .values({
        email: `test-${crypto.randomUUID()}@example.com`,
        username: `u-${crypto.randomUUID()}`,
        passwordHash: "hash",
        fullName: "Test User 2",
      })
      .returning();
    testUserId2 = user2[0].id;

    // Create test household
    const household = await householdRepository.create({
      name: "Test Household",
      currency: "USD",
    });
    testHouseholdId = household.id;
  });

  afterEach(async () => {
    // Cleanup - scoped ONLY to rows this file created this test, never the
    // whole table (see file-header note on the P8b test-isolation flake).
    const householdIds = [testHouseholdId, ...extraHouseholdIds];
    const userIds = [testUserId, testUserId2, ...extraUserIds];

    await db
      .delete(householdMembers)
      .where(inArray(householdMembers.householdId, householdIds));
    await db
      .delete(householdInvitations)
      .where(inArray(householdInvitations.householdId, householdIds));
    await db.delete(households).where(inArray(households.id, householdIds));
    await db.delete(users).where(inArray(users.id, userIds));
  });

  describe("Household CRUD", () => {
    it("should create a household", async () => {
      const household = await householdRepository.create({
        name: "New Household",
        currency: "EUR",
      });
      extraHouseholdIds.push(household.id);

      expect(household).toBeDefined();
      expect(household.name).toBe("New Household");
      expect(household.currency).toBe("EUR");
      expect(household.id).toBeDefined();
    });

    it("should find household by id", async () => {
      const found = await householdRepository.findById(testHouseholdId);
      expect(found).toBeDefined();
      expect(found!.id).toBe(testHouseholdId);
      expect(found!.name).toBe("Test Household");
    });

    it("should return undefined for non-existent household", async () => {
      const found = await householdRepository.findById(crypto.randomUUID());
      expect(found).toBeUndefined();
    });

    it("should update household", async () => {
      const updated = await householdRepository.update(testHouseholdId, {
        name: "Updated Name",
        currency: "GBP",
      });

      expect(updated).toBeDefined();
      expect(updated!.name).toBe("Updated Name");
      expect(updated!.currency).toBe("GBP");
    });

    it("should find household by userId", async () => {
      await householdRepository.addMember({
        householdId: testHouseholdId,
        userId: testUserId,
        role: "owner",
      });

      const found = await householdRepository.findByUserId(testUserId);
      expect(found).toBeDefined();
      expect(found!.id).toBe(testHouseholdId);
    });

    // EDGE-007: Test very long household name
    it("should handle very long household name", async () => {
      const longName = "A".repeat(255);
      const household = await householdRepository.create({
        name: longName,
        currency: "USD",
      });
      extraHouseholdIds.push(household.id);

      expect(household.name).toBe(longName);
      expect(household.name.length).toBe(255);
    });

    // EDGE-008: Test unicode household name
    it("should handle unicode household name", async () => {
      const unicodeName = "🏠 家庭 Famille 家族 परिवार";
      const household = await householdRepository.create({
        name: unicodeName,
        currency: "USD",
      });
      extraHouseholdIds.push(household.id);

      expect(household.name).toBe(unicodeName);
    });
  });

  describe("Member Management", () => {
    it("should add member to household", async () => {
      const member = await householdRepository.addMember({
        householdId: testHouseholdId,
        userId: testUserId,
        role: "owner",
      });

      expect(member).toBeDefined();
      expect(member.householdId).toBe(testHouseholdId);
      expect(member.userId).toBe(testUserId);
      expect(member.role).toBe("owner");
    });

    it("should find member by household and user id", async () => {
      await householdRepository.addMember({
        householdId: testHouseholdId,
        userId: testUserId,
        role: "admin",
      });

      const member = await householdRepository.findMember(
        testHouseholdId,
        testUserId
      );

      expect(member).toBeDefined();
      expect(member!.role).toBe("admin");
    });

    it("should find all members in household", async () => {
      await householdRepository.addMember({
        householdId: testHouseholdId,
        userId: testUserId,
        role: "owner",
      });

      await householdRepository.addMember({
        householdId: testHouseholdId,
        userId: testUserId2,
        role: "member",
      });

      const members = await householdRepository.findMembers(testHouseholdId);
      expect(members).toHaveLength(2);
    });

    it("should update member role", async () => {
      await householdRepository.addMember({
        householdId: testHouseholdId,
        userId: testUserId,
        role: "member",
      });

      const updated = await householdRepository.updateMemberRole(
        testHouseholdId,
        testUserId,
        "admin"
      );

      expect(updated).toBeDefined();
      expect(updated!.role).toBe("admin");
    });

    it("should remove member from household", async () => {
      await householdRepository.addMember({
        householdId: testHouseholdId,
        userId: testUserId,
        role: "member",
      });

      await householdRepository.removeMember(testHouseholdId, testUserId);

      const member = await householdRepository.findMember(
        testHouseholdId,
        testUserId
      );
      expect(member).toBeUndefined();
    });

    // EDGE-004: Re-adding the same user to the same household is rejected, and
    // the duplicate never persists. Backed by the
    // household_members_household_user_unique constraint + addMember's 23505 ->
    // ConflictError translation. (Previously the table had no unique constraint,
    // so the second insert silently succeeded and left two rows.)
    it("rejects duplicate member addition with ConflictError and keeps one row", async () => {
      await householdRepository.addMember({
        householdId: testHouseholdId,
        userId: testUserId,
        role: "member",
      });

      await expect(
        householdRepository.addMember({
          householdId: testHouseholdId,
          userId: testUserId,
          role: "admin",
        })
      ).rejects.toBeInstanceOf(ConflictError);

      // The duplicate insert did not persist: exactly one membership row remains.
      const rows = (
        await householdRepository.findMembers(testHouseholdId)
      ).filter((m) => m.userId === testUserId);
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe("member");
    });

    // EDGE-006: Test remove non-existent member
    it("should handle removing non-existent member gracefully", async () => {
      // Should not throw, just complete without error
      await expect(
        householdRepository.removeMember(testHouseholdId, crypto.randomUUID())
      ).resolves.not.toThrow();
    });
  });

  describe("Invitation Management", () => {
    it("should create invitation", async () => {
      const inviteCode = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitation = await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "invitee@example.com",
        role: "member",
        inviteCode,
        invitedBy: testUserId,
        expiresAt,
      });

      expect(invitation).toBeDefined();
      expect(invitation.email).toBe("invitee@example.com");
      expect(invitation.role).toBe("member");
      expect(invitation.inviteCode).toBe(inviteCode);
    });

    it("should find invitation by code", async () => {
      const inviteCode = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "invitee@example.com",
        role: "member",
        inviteCode,
        invitedBy: testUserId,
        expiresAt,
      });

      const found = await householdRepository.findInvitationByCode(inviteCode);
      expect(found).toBeDefined();
      expect(found!.inviteCode).toBe(inviteCode);
    });

    it("should find invitation by id and household", async () => {
      const inviteCode = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitation = await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "invitee@example.com",
        role: "member",
        inviteCode,
        invitedBy: testUserId,
        expiresAt,
      });

      const found = await householdRepository.findInvitationById(
        invitation.id,
        testHouseholdId
      );
      expect(found).toBeDefined();
      expect(found!.id).toBe(invitation.id);
    });

    it("should find pending invitations by household", async () => {
      const inviteCode1 = crypto.randomBytes(32).toString("hex");
      const inviteCode2 = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "invitee1@example.com",
        role: "member",
        inviteCode: inviteCode1,
        invitedBy: testUserId,
        expiresAt,
      });

      await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "invitee2@example.com",
        role: "admin",
        inviteCode: inviteCode2,
        invitedBy: testUserId,
        expiresAt,
      });

      const pending =
        await householdRepository.findPendingInvitationsByHousehold(
          testHouseholdId
        );
      expect(pending).toHaveLength(2);
    });

    it("should not return expired invitations as pending", async () => {
      const inviteCode = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() - 1); // Expired yesterday

      await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "expired@example.com",
        role: "member",
        inviteCode,
        invitedBy: testUserId,
        expiresAt,
      });

      const pending =
        await householdRepository.findPendingInvitationsByHousehold(
          testHouseholdId
        );
      expect(pending).toHaveLength(0);
    });

    it("should find pending invitation by email", async () => {
      const inviteCode = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const email = "specific@example.com";

      await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email,
        role: "member",
        inviteCode,
        invitedBy: testUserId,
        expiresAt,
      });

      const found = await householdRepository.findPendingInvitationByEmail(
        testHouseholdId,
        email
      );
      expect(found).toBeDefined();
      expect(found!.email).toBe(email);
    });

    it("should mark invitation as accepted", async () => {
      const inviteCode = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitation = await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "accept@example.com",
        role: "member",
        inviteCode,
        invitedBy: testUserId,
        expiresAt,
      });

      const accepted = await householdRepository.markInvitationAccepted(
        invitation.id,
        testUserId2
      );

      expect(accepted).toBeDefined();
      expect(accepted!.acceptedAt).toBeDefined();
      expect(accepted!.acceptedBy).toBe(testUserId2);
    });

    it("should update invitation expiry", async () => {
      const inviteCode = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitation = await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "renew@example.com",
        role: "member",
        inviteCode,
        invitedBy: testUserId,
        expiresAt,
      });

      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 14);

      const updated = await householdRepository.updateInvitationExpiry(
        invitation.id,
        testHouseholdId,
        newExpiresAt
      );

      expect(updated).toBeDefined();
      expect(updated!.expiresAt.getTime()).toBe(newExpiresAt.getTime());
    });

    it("should delete invitation", async () => {
      const inviteCode = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invitation = await householdRepository.createInvitation({
        householdId: testHouseholdId,
        email: "delete@example.com",
        role: "member",
        inviteCode,
        invitedBy: testUserId,
        expiresAt,
      });

      await householdRepository.deleteInvitation(
        invitation.id,
        testHouseholdId
      );

      const found = await householdRepository.findInvitationById(
        invitation.id,
        testHouseholdId
      );
      expect(found).toBeUndefined();
    });
  });

  describe("Preferences", () => {
    it("should create household preferences", async () => {
      const prefs = await householdRepository.createPreferences({
        householdId: testHouseholdId,
      });

      expect(prefs).toBeDefined();
      expect(prefs.householdId).toBe(testHouseholdId);
    });

    it("should find household preferences", async () => {
      await householdRepository.createPreferences({
        householdId: testHouseholdId,
      });

      const prefs = await householdRepository.findPreferences(testHouseholdId);
      expect(prefs).toBeDefined();
      expect(prefs!.householdId).toBe(testHouseholdId);
    });

    it("should update household preferences", async () => {
      await householdRepository.createPreferences({
        householdId: testHouseholdId,
      });

      const updated = await householdRepository.updatePreferences(
        testHouseholdId,
        {
          // Add any preference fields here
        }
      );

      expect(updated).toBeDefined();
    });
  });
});
