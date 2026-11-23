import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateAge,
  formatPhonePreview,
  isValidZambianNumber,
} from "../profileHelpers";

describe("profileHelpers", () => {
  describe("calculateAge", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 2, 1, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should calculate age correctly", () => {
      const birthDate = new Date("1990-01-01");
      const currentYear = new Date().getFullYear();
      const expectedAge = currentYear - 1990;

      expect(calculateAge(birthDate)).toBe(expectedAge);
    });

    it("should handle leap years correctly", () => {
      const birthDate = new Date("2000-02-29");
      const currentYear = new Date().getFullYear();
      const expectedAge = currentYear - 2000;

      expect(calculateAge(birthDate)).toBe(expectedAge);
    });
  });

  describe("formatPhonePreview", () => {
    it("should format Zambian mobile numbers correctly", () => {
      expect(formatPhonePreview("+260971234567")).toBe("097 123 4567");
      expect(formatPhonePreview("+260961234567")).toBe("096 123 4567");
    });

    it("should format international numbers", () => {
      expect(formatPhonePreview("+1234567890")).toBe("+1234567890");
    });

    it("should handle invalid numbers gracefully", () => {
      expect(formatPhonePreview("")).toBe("");
      expect(formatPhonePreview("invalid")).toBe("invalid");
    });
  });

  describe("isValidZambianNumber", () => {
    it("should validate Zambian mobile numbers", () => {
      expect(isValidZambianNumber("+260971234567")).toBe(true);
      expect(isValidZambianNumber("+260961234567")).toBe(true);
    });

    it("accepts the 07x mobile prefixes the provider badge recognises", () => {
      expect(isValidZambianNumber("+260770000001")).toBe(true); // Airtel 077
      expect(isValidZambianNumber("+260761234567")).toBe(true); // MTN 076
      expect(isValidZambianNumber("+260751234567")).toBe(true); // Zamtel 075
      expect(isValidZambianNumber("+260981234567")).toBe(true); // Zed Mobile 098
      expect(isValidZambianNumber("+260211234567")).toBe(true); // Lusaka landline
    });

    it("rejects 260 numbers with an unknown prefix", () => {
      expect(isValidZambianNumber("+260711234567")).toBe(false);
      expect(isValidZambianNumber("+260911234567")).toBe(false);
    });

    it("should reject invalid Zambian numbers", () => {
      expect(isValidZambianNumber("+26012345")).toBe(false);
      expect(isValidZambianNumber("+260123456789")).toBe(false);
      expect(isValidZambianNumber("0971234567")).toBe(false);
    });

    it("should handle non-Zambian numbers", () => {
      expect(isValidZambianNumber("+1234567890")).toBe(false);
      expect(isValidZambianNumber("+44123456789")).toBe(false);
    });
  });
});
