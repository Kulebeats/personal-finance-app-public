import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { profileSchema } from "../profileSchema";

// Valid base data for all property tests - includes all required fields
const validBaseData = {
  fullName: "Test User",
  firstName: "Test",
  lastName: "User",
  gender: "male" as const,
  birthday: null,
  address: {
    addressLine1: "123 Test Street",
    city: "Lusaka",
    country: "ZM",
  },
  nrc: "123456/78/9",
  socialLinks: {
    linkedin: "",
    facebook: "",
    twitter: "",
    github: "",
    email: "test@example.com",
    website: "",
  },
};

/**
 * **Feature: settings-refactoring, Property 1: Zod Schema Validation Consistency**
 * **Validates: Requirements 2.2, 2.5**
 *
 * Property: For any input data, the Zod schema validation SHALL either accept
 * valid data conforming to the schema or reject invalid data with appropriate error messages.
 */
describe("Property 1: Zod Schema Validation Consistency", () => {
  // Configure fast-check to run 100 iterations
  const fcOptions = { numRuns: 100 };

  it("accepts all valid profile data with required fields", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (fullName) => {
        const data = { ...validBaseData, fullName };
        const result = profileSchema.safeParse(data);
        return result.success === true;
      }),
      fcOptions
    );
  });

  it("rejects all empty fullName values", () => {
    fc.assert(
      fc.property(fc.constant(""), (fullName) => {
        const data = { ...validBaseData, fullName };
        const result = profileSchema.safeParse(data);
        return result.success === false;
      }),
      fcOptions
    );
  });

  it("rejects all fullName values exceeding 100 characters", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 101, maxLength: 200 }), (longName) => {
        const data = { ...validBaseData, fullName: longName };
        const result = profileSchema.safeParse(data);
        return result.success === false;
      }),
      fcOptions
    );
  });

  it("accepts all valid Zambian phone numbers", () => {
    fc.assert(
      fc.property(
        // Generate valid Zambian phone numbers: +260 followed by 9 digits
        fc
          .array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 })
          .map((digits) => `+260${digits.join("")}`),
        (phoneNumber) => {
          const data = { ...validBaseData, phoneNumberMobile: phoneNumber };
          const result = profileSchema.safeParse(data);
          return result.success === true;
        }
      ),
      fcOptions
    );
  });

  it("accepts all 9-digit phone numbers", () => {
    fc.assert(
      fc.property(
        // Generate valid 9-digit numbers
        fc
          .array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 })
          .map((digits) => digits.join("")),
        (phoneNumber) => {
          const data = { ...validBaseData, phoneNumberMobile: phoneNumber };
          const result = profileSchema.safeParse(data);
          return result.success === true;
        }
      ),
      fcOptions
    );
  });

  it("accepts all valid birthdays (adults only, 18+)", () => {
    // Generate birthdates for people 18+ with a 2-day buffer for timezone safety
    const today = new Date();
    const eighteenYearsAgo = new Date(
      today.getFullYear() - 18,
      today.getMonth(),
      today.getDate() - 2 // 2-day buffer for timezone edge cases
    ).getTime();
    fc.assert(
      fc.property(
        fc
          .integer({
            min: new Date(1920, 0, 1).getTime(),
            max: eighteenYearsAgo,
          })
          .map((timestamp) => new Date(timestamp)),
        (birthday) => {
          const data = { ...validBaseData, birthday };
          const result = profileSchema.safeParse(data);
          return result.success === true;
        }
      ),
      fcOptions
    );
  });

  it("rejects all future birthdays", () => {
    fc.assert(
      fc.property(
        // Generate dates in the future using integer timestamps
        fc
          .integer({
            min: Date.now() + 24 * 60 * 60 * 1000, // Tomorrow
            max: new Date(2100, 0, 1).getTime(),
          })
          .map((timestamp) => new Date(timestamp)),
        (futureBirthday) => {
          const data = { ...validBaseData, birthday: futureBirthday };
          const result = profileSchema.safeParse(data);
          return result.success === false;
        }
      ),
      fcOptions
    );
  });

  it("consistently applies default values for optional fields", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 100 }), (fullName) => {
        const data = { ...validBaseData, fullName };
        const result = profileSchema.safeParse(data);
        if (!result.success) return false;

        // Check that defaults are applied consistently
        return (
          result.data.timezone === "Africa/Lusaka" &&
          result.data.incomeFrequency === "monthly" &&
          result.data.birthdayHideYear === false
        );
      }),
      fcOptions
    );
  });

  it("accepts all valid gender values", () => {
    fc.assert(
      fc.property(fc.constantFrom("male", "female"), (gender) => {
        const data = { ...validBaseData, gender };
        const result = profileSchema.safeParse(data);
        return result.success === true;
      }),
      fcOptions
    );
  });

  it("accepts all valid employment status values", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          "employed",
          "self-employed",
          "retired",
          "unemployed",
          "student",
          ""
        ),
        (employmentStatus) => {
          const data = { ...validBaseData, employmentStatus };
          const result = profileSchema.safeParse(data);
          return result.success === true;
        }
      ),
      fcOptions
    );
  });

  it("accepts all valid income frequency values", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("monthly", "bi-weekly", "annual"),
        (incomeFrequency) => {
          const data = { ...validBaseData, incomeFrequency };
          const result = profileSchema.safeParse(data);
          return result.success === true;
        }
      ),
      fcOptions
    );
  });
});
