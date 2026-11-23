import { describe, it, expect } from "vitest";
import { profileSchema } from "../profileSchema";
import { PROFILE_SOCIAL_LINK_MAX_LENGTH, SOCIAL_LINK_TOO_LONG_MESSAGE } from "@shared/profile-policy";

// Valid base data for tests - includes all required fields with proper types
const validProfileData = {
  fullName: "John Doe",
  firstName: "John",
  lastName: "Doe",
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

describe("profileSchema", () => {
  describe("fullName validation", () => {
    it("accepts valid full name", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        fullName: "John Doe",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty full name", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        fullName: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const fullNameError = result.error.issues.find((i) =>
          i.path.includes("fullName")
        );
        expect(fullNameError?.message).toBe("Full name is required");
      }
    });

    it("rejects full name exceeding 100 characters", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        fullName: "a".repeat(101),
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const fullNameError = result.error.issues.find((i) =>
          i.path.includes("fullName")
        );
        expect(fullNameError?.message).toBe(
          "Name cannot exceed 100 characters"
        );
      }
    });
  });

  describe("phone number validation", () => {
    it("accepts valid Zambian phone number", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        phoneNumberMobile: "+260971234567",
      });
      expect(result.success).toBe(true);
    });

    it("accepts 9-digit phone number without country code", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        phoneNumberMobile: "971234567",
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty phone number", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        phoneNumberMobile: "",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid phone number format", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        phoneNumberMobile: "12345", // Too short
      });
      expect(result.success).toBe(false);
    });

    it("rejects phone number with wrong country code", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        phoneNumberMobile: "+1234567890",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("birthday validation", () => {
    it("accepts valid birthday", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        birthday: new Date(1990, 5, 15),
      });
      expect(result.success).toBe(true);
    });

    it("accepts null birthday", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        birthday: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects future birthday", () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const result = profileSchema.safeParse({
        ...validProfileData,
        birthday: futureDate,
      });
      expect(result.success).toBe(false);
    });

    it("rejects birthday for users under 18", () => {
      const recentDate = new Date();
      recentDate.setFullYear(recentDate.getFullYear() - 10); // 10 years old

      const result = profileSchema.safeParse({
        ...validProfileData,
        birthday: recentDate,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("default values", () => {
    it("applies default timezone", () => {
      const result = profileSchema.safeParse(validProfileData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timezone).toBe("Africa/Lusaka");
      }
    });

    it("applies default incomeFrequency", () => {
      const result = profileSchema.safeParse(validProfileData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.incomeFrequency).toBe("monthly");
      }
    });

    it("applies default birthdayHideYear", () => {
      const result = profileSchema.safeParse(validProfileData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.birthdayHideYear).toBe(false);
      }
    });
  });

  describe("required fields", () => {
    it("requires firstName", () => {
      const { firstName, ...data } = validProfileData;
      const result = profileSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("requires lastName", () => {
      const { lastName, ...data } = validProfileData;
      const result = profileSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("requires gender", () => {
      const { gender, ...data } = validProfileData;
      const result = profileSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("requires address", () => {
      const { address, ...data } = validProfileData;
      const result = profileSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("accepts missing nrc (optional field)", () => {
      const { nrc, ...data } = validProfileData;
      const result = profileSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("refuses a country code that is not two letters", () => {
      const result = profileSchema.safeParse({ ...validProfileData, address: { ...validProfileData.address, country: "1!" } });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map(issue => issue.message)).toEqual(["Country code must be 2 letters"]);
    });
  });

  describe("nrc validation", () => {
    it("accepts valid NRC format", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        nrc: "123456/78/9",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid NRC format", () => {
      const result = profileSchema.safeParse({
        ...validProfileData,
        nrc: "12345678",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("rules shared with the server (shared/profile-policy.ts)", () => {
  const website = (length: number) =>
    `https://example.test/${"a".repeat(length - "https://example.test/".length)}`;

  it("caps social links at the length the server accepts", () => {
    const ok = profileSchema.safeParse({
      ...validProfileData,
      socialLinks: { ...validProfileData.socialLinks, website: website(PROFILE_SOCIAL_LINK_MAX_LENGTH) },
    });
    expect(ok.success).toBe(true);

    const tooLong = profileSchema.safeParse({
      ...validProfileData,
      socialLinks: { ...validProfileData.socialLinks, website: website(PROFILE_SOCIAL_LINK_MAX_LENGTH + 1) },
    });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues.map(issue => issue.message)).toContain(SOCIAL_LINK_TOO_LONG_MESSAGE);
    }
  });

  it("accepts an 18th birthday that is today and refuses one that is tomorrow (local day)", () => {
    const today = new Date();
    const eighteenToday = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
    const eighteenTomorrow = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate() + 1);

    expect(profileSchema.safeParse({ ...validProfileData, birthday: eighteenToday }).success).toBe(true);
    const underage = profileSchema.safeParse({ ...validProfileData, birthday: eighteenTomorrow });
    expect(underage.success).toBe(false);
    if (!underage.success) {
      expect(underage.error.issues.map(issue => issue.message)).toEqual(["You must be at least 18 years old"]);
    }
  });
});
