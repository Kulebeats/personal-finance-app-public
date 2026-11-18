/**
 * Household Validation Schema Tests
 *
 * TEST-005: Comprehensive validation tests
 * VAL-002: Test invalid role assignment
 */

import { describe, it, expect } from "vitest";
import {
  householdRoleSchema,
  createHouseholdSchema,
  updateHouseholdSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
  acceptInviteSchema,
} from "../household.validation";

describe("Household Validation Schemas", () => {
  describe("householdRoleSchema", () => {
    it("should accept valid roles", () => {
      expect(householdRoleSchema.parse("owner")).toBe("owner");
      expect(householdRoleSchema.parse("admin")).toBe("admin");
      expect(householdRoleSchema.parse("member")).toBe("member");
      expect(householdRoleSchema.parse("view_only")).toBe("view_only");
    });

    // VAL-002: Test invalid role assignment
    it("should reject invalid roles", () => {
      expect(() => householdRoleSchema.parse("invalid")).toThrow();
      expect(() => householdRoleSchema.parse("viewer")).toThrow(); // Old value
      expect(() => householdRoleSchema.parse("superadmin")).toThrow();
      expect(() => householdRoleSchema.parse("")).toThrow();
      expect(() => householdRoleSchema.parse(null)).toThrow();
      expect(() => householdRoleSchema.parse(undefined)).toThrow();
    });
  });

  describe("createHouseholdSchema", () => {
    it("should accept valid household creation data", () => {
      const result = createHouseholdSchema.parse({
        name: "My Household",
        currency: "USD",
      });

      expect(result.name).toBe("My Household");
      expect(result.currency).toBe("USD");
    });

    it("should use default currency if not provided", () => {
      const result = createHouseholdSchema.parse({
        name: "My Household",
      });

      expect(result.currency).toBe("USD");
    });

    it("should accept optional timezone", () => {
      const result = createHouseholdSchema.parse({
        name: "My Household",
        currency: "EUR",
        timezone: "Europe/London",
      });

      expect(result.timezone).toBe("Europe/London");
    });

    it("should reject empty name", () => {
      expect(() =>
        createHouseholdSchema.parse({
          name: "",
          currency: "USD",
        })
      ).toThrow();
    });

    it("should reject name over 100 characters", () => {
      const longName = "A".repeat(101);
      expect(() =>
        createHouseholdSchema.parse({
          name: longName,
          currency: "USD",
        })
      ).toThrow();
    });

    it("should reject invalid currency length", () => {
      expect(() =>
        createHouseholdSchema.parse({
          name: "My Household",
          currency: "US", // Too short
        })
      ).toThrow();

      expect(() =>
        createHouseholdSchema.parse({
          name: "My Household",
          currency: "USDD", // Too long
        })
      ).toThrow();
    });

    it("should reject timezone over 50 characters", () => {
      const longTimezone = "A".repeat(51);
      expect(() =>
        createHouseholdSchema.parse({
          name: "My Household",
          currency: "USD",
          timezone: longTimezone,
        })
      ).toThrow();
    });

    it("should accept unicode in name", () => {
      const result = createHouseholdSchema.parse({
        name: "🏠 家庭 Famille",
        currency: "USD",
      });

      expect(result.name).toBe("🏠 家庭 Famille");
    });
  });

  describe("updateHouseholdSchema", () => {
    it("should accept partial updates", () => {
      const result = updateHouseholdSchema.parse({
        name: "Updated Name",
      });

      expect(result.name).toBe("Updated Name");
      expect(result.currency).toBeUndefined();
    });

    it("should accept currency update only", () => {
      const result = updateHouseholdSchema.parse({
        currency: "GBP",
      });

      expect(result.currency).toBe("GBP");
      expect(result.name).toBeUndefined();
    });

    it("should accept empty object", () => {
      const result = updateHouseholdSchema.parse({});
      expect(result).toEqual({});
    });

    it("should reject invalid data types", () => {
      expect(() =>
        updateHouseholdSchema.parse({
          name: 123, // Should be string
        })
      ).toThrow();
    });
  });

  describe("inviteMemberSchema", () => {
    it("should accept valid invitation data", () => {
      const result = inviteMemberSchema.parse({
        email: "user@example.com",
        role: "member",
        message: "Join our household!",
      });

      expect(result.email).toBe("user@example.com");
      expect(result.role).toBe("member");
      expect(result.message).toBe("Join our household!");
    });

    it("should use default role if not provided", () => {
      const result = inviteMemberSchema.parse({
        email: "user@example.com",
      });

      expect(result.role).toBe("member");
    });

    it("should accept optional message", () => {
      const result = inviteMemberSchema.parse({
        email: "user@example.com",
        role: "admin",
      });

      expect(result.message).toBeUndefined();
    });

    it("should reject invalid email", () => {
      expect(() =>
        inviteMemberSchema.parse({
          email: "not-an-email",
          role: "member",
        })
      ).toThrow();

      expect(() =>
        inviteMemberSchema.parse({
          email: "missing-at-sign.com",
          role: "member",
        })
      ).toThrow();
    });

    it("should reject invalid role", () => {
      expect(() =>
        inviteMemberSchema.parse({
          email: "user@example.com",
          role: "superadmin",
        })
      ).toThrow();
    });

    it("should reject message over 500 characters", () => {
      const longMessage = "A".repeat(501);
      expect(() =>
        inviteMemberSchema.parse({
          email: "user@example.com",
          role: "member",
          message: longMessage,
        })
      ).toThrow();
    });

    it("should accept message exactly 500 characters", () => {
      const maxMessage = "A".repeat(500);
      const result = inviteMemberSchema.parse({
        email: "user@example.com",
        role: "member",
        message: maxMessage,
      });

      expect(result.message).toBe(maxMessage);
    });
  });

  describe("updateMemberRoleSchema", () => {
    it("should accept valid role update", () => {
      const result = updateMemberRoleSchema.parse({
        role: "admin",
      });

      expect(result.role).toBe("admin");
    });

    it("should accept all valid roles", () => {
      expect(
        updateMemberRoleSchema.parse({ role: "owner" }).role
      ).toBe("owner");
      expect(
        updateMemberRoleSchema.parse({ role: "admin" }).role
      ).toBe("admin");
      expect(
        updateMemberRoleSchema.parse({ role: "member" }).role
      ).toBe("member");
      expect(
        updateMemberRoleSchema.parse({ role: "view_only" }).role
      ).toBe("view_only");
    });

    it("should reject invalid role", () => {
      expect(() =>
        updateMemberRoleSchema.parse({ role: "invalid" })
      ).toThrow();

      expect(() =>
        updateMemberRoleSchema.parse({ role: "viewer" }) // Old value
      ).toThrow();
    });

    it("should require role field", () => {
      expect(() => updateMemberRoleSchema.parse({})).toThrow();
    });
  });

  describe("acceptInviteSchema", () => {
    it("should accept valid invite code", () => {
      const result = acceptInviteSchema.parse({
        inviteCode: "valid-invite-code-123",
      });

      expect(result.inviteCode).toBe("valid-invite-code-123");
    });

    it("should reject empty invite code", () => {
      expect(() =>
        acceptInviteSchema.parse({ inviteCode: "" })
      ).toThrow();
    });

    it("should reject invite code over 100 characters", () => {
      const longCode = "A".repeat(101);
      expect(() =>
        acceptInviteSchema.parse({ inviteCode: longCode })
      ).toThrow();
    });

    it("should require inviteCode field", () => {
      expect(() => acceptInviteSchema.parse({})).toThrow();
    });

    it("should accept 64 character hex string (typical crypto output)", () => {
      const hexCode = "a".repeat(64);
      const result = acceptInviteSchema.parse({ inviteCode: hexCode });
      expect(result.inviteCode).toBe(hexCode);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null values appropriately", () => {
      expect(() =>
        createHouseholdSchema.parse({
          name: null,
          currency: "USD",
        })
      ).toThrow();
    });

    it("should handle undefined required fields", () => {
      expect(() =>
        createHouseholdSchema.parse({
          currency: "USD",
        })
      ).toThrow();
    });

    it("should handle extra fields gracefully", () => {
      const result = createHouseholdSchema.parse({
        name: "My Household",
        currency: "USD",
        extraField: "should be ignored",
      });

      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("currency");
      expect(result).not.toHaveProperty("extraField");
    });
  });
});
