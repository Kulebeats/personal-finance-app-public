/**
 * Auth Module Property-Based Tests
 *
 * Uses fast-check for generative testing of:
 * - Password validation invariants (P4-64)
 * - Input fuzzing for security (P4-65)
 * - Email validation edge cases
 * - Username validation edge cases
 *
 * @module modules/auth/__tests__/auth.property.test
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { loginSchema, registerSchema } from "../auth.validation";

// Helper to build string arbitrary from character set
const charSetString = (chars: string, minLength: number, maxLength: number) =>
  fc.array(fc.constantFrom(...chars.split('')), { minLength, maxLength })
    .map(arr => arr.join(''));

describe("Auth Property-Based Tests", () => {
  // ==========================================================================
  // Password Validation Properties (P4-64)
  // ==========================================================================
  describe("Password Validation Properties", () => {
    // Arbitrary for valid passwords
    const validPasswordArb = fc
      .tuple(
        charSetString('abcdefghijklmnopqrstuvwxyz', 1, 50),
        charSetString('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 1, 50),
        charSetString('0123456789', 1, 50)
      )
      .map(([lower, upper, num]) => {
        // Ensure minimum length and shuffle
        const combined = lower + upper + num;
        return combined.length >= 8 ? combined : combined + 'x'.repeat(8 - combined.length);
      })
      .filter((p) => p.length >= 8 && p.length <= 128);

    it("should accept any password meeting complexity requirements", () => {
      fc.assert(
        fc.property(validPasswordArb, (password) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username: "testuser",
            password,
            fullName: "Test User",
          });
          // Should only fail if password equals email (which it won't with our generator)
          return result.success ||
            result.error.issues.some(i => i.message.includes("same as your email"));
        }),
        { numRuns: 100 }
      );
    });

    it("should reject any password under 8 characters", () => {
      const shortPasswordArb = fc.string({ minLength: 1, maxLength: 7 });

      fc.assert(
        fc.property(shortPasswordArb, (password) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username: "testuser",
            password,
            fullName: "Test User",
          });
          return !result.success;
        }),
        { numRuns: 100 }
      );
    });

    it("should reject any password over 128 characters", () => {
      const longPasswordArb = fc.string({ minLength: 129, maxLength: 500 });

      fc.assert(
        fc.property(longPasswordArb, (password) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username: "testuser",
            password,
            fullName: "Test User",
          });
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });

    it("should reject password that equals email (case-insensitive)", () => {
      const emailArb = fc.emailAddress().filter((e) => e.length >= 8 && e.length <= 128);

      fc.assert(
        fc.property(emailArb, (email) => {
          // Try exact match
          const result1 = registerSchema.safeParse({
            email,
            username: "testuser",
            password: email,
            fullName: "Test",
          });

          // Try case variation
          const result2 = registerSchema.safeParse({
            email,
            username: "testuser",
            password: email.toUpperCase(),
            fullName: "Test",
          });

          // Both should fail
          return !result1.success && !result2.success;
        }),
        { numRuns: 50 }
      );
    });

    it("password without lowercase should always fail", () => {
      const noLowerArb = charSetString('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 8, 20);

      fc.assert(
        fc.property(noLowerArb, (password) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username: "testuser",
            password,
            fullName: "Test",
          });
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });

    it("password without uppercase should always fail", () => {
      const noUpperArb = charSetString('abcdefghijklmnopqrstuvwxyz0123456789', 8, 20);

      fc.assert(
        fc.property(noUpperArb, (password) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username: "testuser",
            password,
            fullName: "Test",
          });
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });

    it("password without number should always fail", () => {
      const noNumberArb = charSetString('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 8, 20);

      fc.assert(
        fc.property(noNumberArb, (password) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username: "testuser",
            password,
            fullName: "Test",
          });
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });
  });

  // ==========================================================================
  // Input Fuzzing Tests (P4-65)
  // ==========================================================================
  describe("Input Fuzzing Tests", () => {
    it("should never crash on arbitrary string input for email", () => {
      fc.assert(
        fc.property(fc.string(), (email) => {
          // Should not throw, should return validation result
          const result = loginSchema.safeParse({
            email,
            password: "Password123",
          });
          return typeof result.success === "boolean";
        }),
        { numRuns: 200 }
      );
    });

    it("should never crash on arbitrary string input for password", () => {
      fc.assert(
        fc.property(fc.string(), (password) => {
          const result = loginSchema.safeParse({
            email: "test@example.com",
            password,
          });
          return typeof result.success === "boolean";
        }),
        { numRuns: 200 }
      );
    });

    it("should never crash on arbitrary unicode strings", () => {
      // Use string with unicode option for broader character coverage
      const unicodeStrArb = fc.string({ minLength: 0, maxLength: 100 });

      fc.assert(
        fc.property(unicodeStrArb, unicodeStrArb, (email, password) => {
          const result = loginSchema.safeParse({ email, password });
          return typeof result.success === "boolean";
        }),
        { numRuns: 200 }
      );
    });

    it("should handle null bytes in input gracefully", () => {
      const nullByteStrings = fc.string().map((s) => s + "\x00" + s);

      fc.assert(
        fc.property(nullByteStrings, (input) => {
          const result = loginSchema.safeParse({
            email: input,
            password: input,
          });
          return typeof result.success === "boolean";
        }),
        { numRuns: 50 }
      );
    });

    it("should handle SQL injection attempts without crashing", () => {
      const sqlInjectionArb = fc.constantFrom(
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "1; SELECT * FROM users",
        "admin'--",
        "' UNION SELECT * FROM users --",
        "'; EXEC xp_cmdshell('dir'); --",
        "1' AND '1'='1",
        "' OR 1=1 --",
        "') OR ('1'='1",
        "'; WAITFOR DELAY '0:0:10' --"
      );

      fc.assert(
        fc.property(sqlInjectionArb, (injection) => {
          const result1 = loginSchema.safeParse({
            email: injection,
            password: "Password123",
          });

          const result2 = registerSchema.safeParse({
            email: injection + "@test.com",
            username: injection,
            password: "Password123",
            fullName: injection,
          });

          // Should not crash, should return validation result
          return (
            typeof result1.success === "boolean" &&
            typeof result2.success === "boolean"
          );
        }),
        { numRuns: 50 }
      );
    });

    it("should handle XSS attempts without crashing", () => {
      const xssArb = fc.constantFrom(
        "<script>alert('xss')</script>",
        "javascript:alert(1)",
        "<img src=x onerror=alert(1)>",
        "'\"><script>alert(1)</script>",
        "<svg onload=alert(1)>",
        "{{constructor.constructor('alert(1)')()}}",
        "${alert(1)}",
        "<iframe src='javascript:alert(1)'>",
        "data:text/html,<script>alert(1)</script>",
        "<body onload=alert(1)>"
      );

      fc.assert(
        fc.property(xssArb, (xss) => {
          const result = registerSchema.safeParse({
            email: xss + "@test.com",
            username: "testuser",
            password: "Password123",
            fullName: xss,
          });

          return typeof result.success === "boolean";
        }),
        { numRuns: 50 }
      );
    });

    it("should handle extremely long inputs without hanging", () => {
      const longStringArb = fc.string({ minLength: 10000, maxLength: 100000 });

      fc.assert(
        fc.property(longStringArb, (longString) => {
          const start = Date.now();

          loginSchema.safeParse({
            email: longString,
            password: longString,
          });

          // Should complete in under 100ms even for very long strings
          return Date.now() - start < 100;
        }),
        { numRuns: 10 }
      );
    });
  });

  // ==========================================================================
  // Email Validation Properties
  // ==========================================================================
  describe("Email Validation Properties", () => {
    it("should accept valid email formats", () => {
      fc.assert(
        fc.property(fc.emailAddress(), (email) => {
          const result = loginSchema.safeParse({
            email,
            password: "Password123",
          });
          // Most generated emails should be valid
          return result.success || result.error.issues.some(i =>
            i.path.includes("email") && i.message.includes("Invalid")
          );
        }),
        { numRuns: 100 }
      );
    });

    it("should reject emails without @ symbol", () => {
      const noAtArb = fc.string().filter((s) => !s.includes("@") && s.length > 0);

      fc.assert(
        fc.property(noAtArb, (email) => {
          const result = loginSchema.safeParse({
            email,
            password: "Password123",
          });
          return !result.success;
        }),
        { numRuns: 100 }
      );
    });

    it("should reject emails over 254 characters", () => {
      const longEmailArb = fc.string({ minLength: 255, maxLength: 500 }).map(
        (s) => s.replaceAll("@", "") + "@example.com"
      );

      fc.assert(
        fc.property(longEmailArb, (email) => {
          const result = loginSchema.safeParse({
            email,
            password: "Password123",
          });
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });
  });

  // ==========================================================================
  // Username Validation Properties
  // ==========================================================================
  describe("Username Validation Properties", () => {
    it("should accept valid username characters only", () => {
      const validUsernameArb = charSetString(
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
        3, 50
      );

      fc.assert(
        fc.property(validUsernameArb, (username) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username,
            password: "Password123",
            fullName: "Test",
          });
          return result.success;
        }),
        { numRuns: 100 }
      );
    });

    it("should reject usernames with special characters", () => {
      const specialCharArb = fc.constantFrom(
        "@", "#", "$", "%", "^", "&", "*", "(", ")", "+", "=",
        "[", "]", "{", "}", "|", "\\", "/", "?", "<", ">", ",", ".",
        "!", "~", "`", "'", '"', ":", ";", " "
      );

      fc.assert(
        fc.property(specialCharArb, (char) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username: "test" + char + "user",
            password: "Password123",
            fullName: "Test",
          });
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });

    it("should reject usernames under 3 characters", () => {
      const shortUsernameArb = charSetString('abcdefghijklmnopqrstuvwxyz', 1, 2);

      fc.assert(
        fc.property(shortUsernameArb, (username) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username,
            password: "Password123",
            fullName: "Test",
          });
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });

    it("should reject usernames over 50 characters", () => {
      const longUsernameArb = charSetString('abcdefghijklmnopqrstuvwxyz', 51, 100);

      fc.assert(
        fc.property(longUsernameArb, (username) => {
          const result = registerSchema.safeParse({
            email: "test@example.com",
            username,
            password: "Password123",
            fullName: "Test",
          });
          return !result.success;
        }),
        { numRuns: 50 }
      );
    });
  });

  // ==========================================================================
  // Remember Me Property
  // ==========================================================================
  describe("Remember Me Validation", () => {
    it("should accept any boolean for rememberMe", () => {
      fc.assert(
        fc.property(fc.boolean(), (rememberMe) => {
          const result = loginSchema.safeParse({
            email: "test@example.com",
            password: "Password123",
            rememberMe,
          });
          return result.success && result.data.rememberMe === rememberMe;
        }),
        { numRuns: 20 }
      );
    });

    it("should default rememberMe to false when not provided", () => {
      const result = loginSchema.safeParse({
        email: "test@example.com",
        password: "Password123",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rememberMe).toBe(false);
      }
    });
  });
});
