/**
 * Recurring Module Validation Tests
 *
 * Tests for Zod schemas covering date validation, parseInt safety,
 * and business rule validation.
 */
import { describe, it, expect } from "vitest";
import {
  createRecurringSchema,
  updateRecurringSchema,
  upcomingQuerySchema,
  historyQuerySchema,
  confirmPatternSchema,
  linkTransactionSchema,
  endRecurringSchema,
  detectPatternsSchema,
  processRecurringSchema,
} from "../recurring.validation";

describe("Recurring Validation Schemas", () => {
  const validAccountId = "22222222-2222-2222-2222-222222222222";
  const validTransactionId = "44444444-4444-4444-4444-444444444444";

  // =========================================================================
  // Date Validation - ISSUE-REC-011 Fix
  // =========================================================================
  describe("Date Validation", () => {
    it("accepts valid dates", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-15",
      });

      expect(result.success).toBe(true);
    });

    it("rejects invalid date Feb 30", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-30", // Invalid
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain("Invalid date");
      }
    });

    it("rejects invalid date Feb 31", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-31",
      });

      expect(result.success).toBe(false);
    });

    it("rejects month 13", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-13-01",
      });

      expect(result.success).toBe(false);
    });

    it("rejects day 0", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-00",
      });

      expect(result.success).toBe(false);
    });

    it("accepts valid leap year date", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-29", // 2024 is a leap year
      });

      expect(result.success).toBe(true);
    });

    it("rejects Feb 29 on non-leap year", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2023-02-29", // 2023 is not a leap year
      });

      expect(result.success).toBe(false);
    });

    it("validates endDate in endRecurringSchema", () => {
      const validResult = endRecurringSchema.safeParse({
        endDate: "2024-12-31",
        reason: "Cancelled",
      });
      expect(validResult.success).toBe(true);

      const invalidResult = endRecurringSchema.safeParse({
        endDate: "2024-02-30",
      });
      expect(invalidResult.success).toBe(false);
    });
  });

  // =========================================================================
  // parseInt Safety - ISSUE-REC-011 Fix
  // =========================================================================
  describe("parseInt Safety", () => {
    describe("upcomingQuerySchema", () => {
      it("uses default 14 when no value provided", () => {
        const result = upcomingQuerySchema.parse({});
        expect(result.days).toBe(14);
      });

      it("parses valid number string", () => {
        const result = upcomingQuerySchema.parse({ days: "30" });
        expect(result.days).toBe(30);
      });

      it("returns default for NaN input", () => {
        const result = upcomingQuerySchema.parse({ days: "abc" });
        expect(result.days).toBe(14);
      });

      it("returns default for negative numbers", () => {
        const result = upcomingQuerySchema.parse({ days: "-5" });
        expect(result.days).toBe(14);
      });

      it("returns default for zero", () => {
        const result = upcomingQuerySchema.parse({ days: "0" });
        expect(result.days).toBe(14);
      });

      it("caps at maximum 365", () => {
        const result = upcomingQuerySchema.parse({ days: "1000" });
        expect(result.days).toBe(365);
      });

      it("handles float strings", () => {
        const result = upcomingQuerySchema.parse({ days: "7.5" });
        expect(result.days).toBe(7); // parseInt truncates
      });
    });

    describe("historyQuerySchema", () => {
      it("uses default 50 when no value provided", () => {
        const result = historyQuerySchema.parse({});
        expect(result.limit).toBe(50);
      });

      it("parses valid number string", () => {
        const result = historyQuerySchema.parse({ limit: "25" });
        expect(result.limit).toBe(25);
      });

      it("returns default for NaN input", () => {
        const result = historyQuerySchema.parse({ limit: "xyz" });
        expect(result.limit).toBe(50);
      });

      it("caps at maximum 100", () => {
        const result = historyQuerySchema.parse({ limit: "500" });
        expect(result.limit).toBe(100);
      });

      it("returns default for empty string", () => {
        const result = historyQuerySchema.parse({ limit: "" });
        expect(result.limit).toBe(50);
      });
    });
  });

  // =========================================================================
  // Custom Frequency Validation
  // =========================================================================
  describe("Custom Frequency Validation", () => {
    it("requires intervalUnit and intervalValue for custom frequency", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Custom Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "custom",
        nextDueDate: "2024-02-15",
        // Missing intervalUnit and intervalValue
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          "Custom frequency requires"
        );
      }
    });

    it("accepts custom frequency with valid interval", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Every 10 Days",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "custom",
        intervalValue: 10,
        intervalUnit: "days",
        nextDueDate: "2024-02-15",
      });

      expect(result.success).toBe(true);
    });

    it("validates intervalValue bounds (1-365)", () => {
      const tooSmall = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "custom",
        intervalValue: 0,
        intervalUnit: "days",
        nextDueDate: "2024-02-15",
      });
      expect(tooSmall.success).toBe(false);

      const tooLarge = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "10.00", currency: "ZMW" },
        type: "expense",
        frequency: "custom",
        intervalValue: 400,
        intervalUnit: "days",
        nextDueDate: "2024-02-15",
      });
      expect(tooLarge.success).toBe(false);
    });
  });

  // =========================================================================
  // Amount Validation
  // =========================================================================
  describe("Amount Validation", () => {
    it("accepts valid MoneyDto amount", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "99.99", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-15",
      });

      expect(result.success).toBe(true);
    });

    it("rejects negative amount", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "-10.00", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-15",
      });

      expect(result.success).toBe(false);
    });

    it("rejects zero amount", () => {
      const result = createRecurringSchema.safeParse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "0", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-15",
      });

      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Update Schema (partial)
  // =========================================================================
  describe("Update Schema", () => {
    it("accepts partial updates", () => {
      const result = updateRecurringSchema.safeParse({
        name: "New Name",
      });

      expect(result.success).toBe(true);
    });

    it("accepts empty update", () => {
      const result = updateRecurringSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("validates date fields when provided", () => {
      const result = updateRecurringSchema.safeParse({
        nextDueDate: "2024-02-30", // Invalid
      });

      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // Pattern Detection Schemas
  // =========================================================================
  describe("detectPatternsSchema", () => {
    it("uses defaults when empty", () => {
      const result = detectPatternsSchema.parse({});
      expect(result.minOccurrences).toBe(3);
      expect(result.lookbackMonths).toBe(6);
      expect(result.confidenceThreshold).toBe(80);
    });

    it("validates bounds", () => {
      const tooFewOccurrences = detectPatternsSchema.safeParse({
        minOccurrences: 1,
      });
      expect(tooFewOccurrences.success).toBe(false);

      const validOccurrences = detectPatternsSchema.safeParse({
        minOccurrences: 2,
      });
      expect(validOccurrences.success).toBe(true);
    });
  });

  describe("confirmPatternSchema", () => {
    it("validates required pattern fields", () => {
      const result = confirmPatternSchema.safeParse({
        accountId: validAccountId,
        pattern: {
          name: "Netflix",
          type: "expense",
          frequency: "monthly",
          estimatedAmount: { amount: "15.99", currency: "ZMW" },
          suggestedStartDate: "2024-01-01",
          suggestedNextDueDate: "2024-02-01",
          sampleTransactionIds: [validTransactionId],
        },
      });

      expect(result.success).toBe(true);
    });

    it("validates amountVariance max (100%)", () => {
      const result = confirmPatternSchema.safeParse({
        accountId: validAccountId,
        pattern: {
          name: "Test",
          type: "expense",
          frequency: "monthly",
          estimatedAmount: { amount: "10.00", currency: "ZMW" },
          amountVariance: 150, // Too high
          suggestedStartDate: "2024-01-01",
          suggestedNextDueDate: "2024-02-01",
          sampleTransactionIds: [validTransactionId],
        },
      });

      expect(result.success).toBe(false);
    });

    it("validates dayOfMonth max (28 for cross-month safety)", () => {
      const result = confirmPatternSchema.safeParse({
        accountId: validAccountId,
        pattern: {
          name: "Test",
          type: "expense",
          frequency: "monthly",
          estimatedAmount: { amount: "10.00", currency: "ZMW" },
          dayOfMonth: 31, // Too high
          suggestedStartDate: "2024-01-01",
          suggestedNextDueDate: "2024-02-01",
          sampleTransactionIds: [validTransactionId],
        },
      });

      expect(result.success).toBe(false);

      const validDay = confirmPatternSchema.safeParse({
        accountId: validAccountId,
        pattern: {
          name: "Test",
          type: "expense",
          frequency: "monthly",
          estimatedAmount: { amount: "10.00", currency: "ZMW" },
          dayOfMonth: 28,
          suggestedStartDate: "2024-01-01",
          suggestedNextDueDate: "2024-02-01",
          sampleTransactionIds: [validTransactionId],
        },
      });

      expect(validDay.success).toBe(true);
    });
  });

  // =========================================================================
  // Link Transaction Schema
  // =========================================================================
  describe("linkTransactionSchema", () => {
    it("validates UUID format", () => {
      const validResult = linkTransactionSchema.safeParse({
        transactionId: validTransactionId,
      });
      expect(validResult.success).toBe(true);

      const invalidResult = linkTransactionSchema.safeParse({
        transactionId: "not-a-uuid",
      });
      expect(invalidResult.success).toBe(false);
    });

    it("validates matchConfidence range (0-100)", () => {
      const validResult = linkTransactionSchema.safeParse({
        transactionId: validTransactionId,
        matchConfidence: 85,
      });
      expect(validResult.success).toBe(true);

      const tooHigh = linkTransactionSchema.safeParse({
        transactionId: validTransactionId,
        matchConfidence: 150,
      });
      expect(tooHigh.success).toBe(false);

      const negative = linkTransactionSchema.safeParse({
        transactionId: validTransactionId,
        matchConfidence: -5,
      });
      expect(negative.success).toBe(false);
    });
  });

  // =========================================================================
  // Process Recurring Schema
  // =========================================================================
  describe("processRecurringSchema", () => {
    it("uses defaults when empty", () => {
      const result = processRecurringSchema.parse({});
      expect(result.dryRun).toBe(false);
      expect(result.asOfDate).toBeUndefined();
    });

    it("accepts dryRun flag", () => {
      const result = processRecurringSchema.parse({ dryRun: true });
      expect(result.dryRun).toBe(true);
    });

    it("accepts valid asOfDate", () => {
      const result = processRecurringSchema.parse({ asOfDate: "2024-06-15" });
      expect(result.asOfDate).toBe("2024-06-15");
    });

    it("rejects invalid asOfDate", () => {
      const result = processRecurringSchema.safeParse({ asOfDate: "2024-02-30" });
      expect(result.success).toBe(false);
    });

    it("accepts both dryRun and asOfDate", () => {
      const result = processRecurringSchema.parse({
        dryRun: true,
        asOfDate: "2024-06-15",
      });
      expect(result.dryRun).toBe(true);
      expect(result.asOfDate).toBe("2024-06-15");
    });
  });

  // =========================================================================
  // Transform Tests
  // =========================================================================
  describe("Schema Transforms", () => {
    it("extracts amount string from MoneyDto", () => {
      const result = createRecurringSchema.parse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "15.99", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-15",
      });

      expect(result.amount).toBe("15.99");
    });

    it("defaults startDate from nextDueDate", () => {
      const result = createRecurringSchema.parse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "15.99", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        nextDueDate: "2024-02-15",
      });

      expect(result.startDate).toBe("2024-02-15");
    });

    it("uses explicit startDate when provided", () => {
      const result = createRecurringSchema.parse({
        accountId: validAccountId,
        name: "Test",
        amount: { amount: "15.99", currency: "ZMW" },
        type: "expense",
        frequency: "monthly",
        startDate: "2024-01-01",
        nextDueDate: "2024-02-15",
      });

      expect(result.startDate).toBe("2024-01-01");
    });
  });
});
