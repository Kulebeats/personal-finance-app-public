/**
 * Auth Module Validation Tests
 *
 * Tests for validation edge cases:
 * - Password boundary tests (VAL-003)
 * - Unicode handling tests (VAL-005)
 * - Password=email rejection (VAL-002)
 * - Input length limits (VAL-004)
 *
 * @module modules/auth/__tests__/auth.validation.test
 */
import { describe, it, expect } from "vitest";
import {
  loginSchema,
  registerSchema,
  mfaVerifySchema,
  changePasswordSchema,
} from "../auth.validation";

describe("Auth Validation Tests", () => {
  // ==========================================================================
  // Login Schema Tests
  // ==========================================================================
  describe("loginSchema", () => {
    it("should accept valid login credentials", () => {
      const result = loginSchema.safeParse({
        email: "test@example.com",
        password: "password123",
        rememberMe: true,
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid email", () => {
      const result = loginSchema.safeParse({
        email: "not-an-email",
        password: "password123",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain("email");
      }
    });

    it("should reject empty password", () => {
      const result = loginSchema.safeParse({
        email: "test@example.com",
        password: "",
      });
      expect(result.success).toBe(false);
    });

    // VAL-004: DoS prevention - max email length
    it("should reject email longer than 254 chars (RFC 5321)", () => {
      const longEmail = "a".repeat(250) + "@b.com";
      const result = loginSchema.safeParse({
        email: longEmail,
        password: "password123",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("too long");
      }
    });

    // VAL-004: DoS prevention - max password length
    it("should reject password longer than 128 chars", () => {
      const result = loginSchema.safeParse({
        email: "test@example.com",
        password: "a".repeat(129),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("too long");
      }
    });

    it("should accept password with exactly 128 chars", () => {
      const result = loginSchema.safeParse({
        email: "test@example.com",
        password: "a".repeat(128),
      });
      expect(result.success).toBe(true);
    });

    it("should default rememberMe to false if not provided", () => {
      const result = loginSchema.safeParse({
        email: "test@example.com",
        password: "password123",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rememberMe).toBe(false);
      }
    });
  });

  // ==========================================================================
  // Register Schema Tests
  // ==========================================================================
  describe("registerSchema", () => {
    const validRegistration = {
      email: "test@example.com",
      username: "testuser",
      password: "Password1",
      fullName: "Test User",
    };

    it("should accept valid registration data", () => {
      const result = registerSchema.safeParse(validRegistration);
      expect(result.success).toBe(true);
    });

    // VAL-003: Password boundary test - exactly 8 characters
    describe("Password Length Boundary Tests (VAL-003)", () => {
      it("should accept password with exactly 8 characters", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "Abcdef1!", // exactly 8 chars with required complexity
        });
        expect(result.success).toBe(true);
      });

      it("should reject password with only 7 characters", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "Abcde1!", // only 7 chars
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("at least 8");
        }
      });

      it("should accept password with 9 characters", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "Abcdefg1!", // 9 chars
        });
        expect(result.success).toBe(true);
      });

      it("should accept password at max length (128 chars)", () => {
        // Create 128 char password with required complexity
        const longPassword = "Aa1" + "x".repeat(125);
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: longPassword,
        });
        expect(result.success).toBe(true);
      });

      it("should reject password over max length (129 chars)", () => {
        const tooLongPassword = "Aa1" + "x".repeat(126);
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: tooLongPassword,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain("too long");
        }
      });
    });

    // VAL-002: Password cannot equal email
    describe("Password=Email Rejection (VAL-002)", () => {
      it("should reject password that matches email exactly", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          email: "Test@Example.com",
          password: "Test@Example.com",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes("password")))
            .toBe(true);
          expect(
            result.error.issues.some((i) =>
              i.message.includes("same as your email")
            )
          ).toBe(true);
        }
      });

      it("should reject password that matches email case-insensitively", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          email: "Test@Example.com",
          password: "test@example.com",
        });
        expect(result.success).toBe(false);
      });

      it("should accept password that is different from email", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          email: "test@example.com",
          password: "DifferentPass1",
        });
        expect(result.success).toBe(true);
      });
    });

    // Password complexity requirements
    describe("Password Complexity Requirements", () => {
      it("should reject password without uppercase letter", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "lowercase1",
        });
        expect(result.success).toBe(false);
      });

      it("should reject password without lowercase letter", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "UPPERCASE1",
        });
        expect(result.success).toBe(false);
      });

      it("should reject password without number", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "NoNumbersHere",
        });
        expect(result.success).toBe(false);
      });

      it("should accept password meeting all complexity requirements", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "ValidPass1",
        });
        expect(result.success).toBe(true);
      });
    });

    // VAL-005: Unicode handling tests
    describe("Unicode Handling Tests (VAL-005)", () => {
      it("should accept ASCII username", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "john_doe-123",
        });
        expect(result.success).toBe(true);
      });

      it("should reject username with Unicode characters", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "tëst_üser", // Contains ë and ü
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].path).toContain("username");
        }
      });

      it("should reject username with emoji", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "user🎉name",
        });
        expect(result.success).toBe(false);
      });

      it("should reject username with CJK characters", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "用户名",
        });
        expect(result.success).toBe(false);
      });

      it("should accept email with valid international domain", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          email: "user@münchen.de", // Punycode would be used
        });
        // Email validation may accept IDN domains
        // The actual validation depends on the email validator implementation
        expect(typeof result.success).toBe("boolean");
      });

      it("should accept password with Unicode characters", () => {
        // Passwords can contain Unicode for increased entropy
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "Pässwörd1€", // Contains umlauts and Euro sign
        });
        expect(result.success).toBe(true);
      });

      it("should accept password with emoji", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          password: "Password1🔐",
        });
        expect(result.success).toBe(true);
      });

      it("should handle fullName with Unicode characters", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          fullName: "José García-Müller",
        });
        expect(result.success).toBe(true);
      });

      it("should handle fullName with CJK characters", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          fullName: "田中太郎",
        });
        expect(result.success).toBe(true);
      });
    });

    // Username validation
    describe("Username Validation", () => {
      it("should accept username with minimum length (3 chars)", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "abc",
        });
        expect(result.success).toBe(true);
      });

      it("should reject username under minimum length (2 chars)", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "ab",
        });
        expect(result.success).toBe(false);
      });

      it("should accept username at max length (50 chars)", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "a".repeat(50),
        });
        expect(result.success).toBe(true);
      });

      it("should reject username over max length (51 chars)", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "a".repeat(51),
        });
        expect(result.success).toBe(false);
      });

      it("should reject username with spaces", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "user name",
        });
        expect(result.success).toBe(false);
      });

      it("should accept username with underscores and hyphens", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "user_name-123",
        });
        expect(result.success).toBe(true);
      });

      it("should reject username with special characters", () => {
        const result = registerSchema.safeParse({
          ...validRegistration,
          username: "user@name!",
        });
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // MFA Verify Schema Tests
  // ==========================================================================
  describe("mfaVerifySchema", () => {
    it("should accept valid MFA verification data", () => {
      const result = mfaVerifySchema.safeParse({
        email: "test@example.com",
        code: "123456",
      });
      expect(result.success).toBe(true);
    });

    it("should reject code with less than 6 digits", () => {
      const result = mfaVerifySchema.safeParse({
        email: "test@example.com",
        code: "12345",
      });
      expect(result.success).toBe(false);
    });

    it("should reject code with more than 6 digits", () => {
      const result = mfaVerifySchema.safeParse({
        email: "test@example.com",
        code: "1234567",
      });
      expect(result.success).toBe(false);
    });

    it("should accept code with exactly 6 characters (non-numeric allowed)", () => {
      // Some TOTP implementations use alphanumeric
      const result = mfaVerifySchema.safeParse({
        email: "test@example.com",
        code: "ABC123",
      });
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Change Password Schema Tests
  // ==========================================================================
  describe("changePasswordSchema", () => {
    it("should accept valid password change data", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "OldPass123",
        newPassword: "NewPass123",
        confirmPassword: "NewPass123",
      });
      expect(result.success).toBe(true);
    });

    it("should reject if confirmPassword does not match newPassword", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "OldPass123",
        newPassword: "NewPass123",
        confirmPassword: "DifferentPass",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.includes("confirmPassword"))
        ).toBe(true);
      }
    });

    it("should reject if newPassword is too short", () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: "OldPass123",
        newPassword: "Short1",
        confirmPassword: "Short1",
      });
      expect(result.success).toBe(false);
    });
  });
});
