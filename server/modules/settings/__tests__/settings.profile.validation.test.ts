import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "@shared/schema";
import { birthdayProblem, NRC_NOT_EDITABLE_MESSAGE, PROFILE_SOCIAL_LINK_MAX_LENGTH } from "@shared/profile-policy";
import { profileUpdateSchemaFor, updateProfileSchema } from "../settings.profile.validation";
import { changedProfileFields, profileFieldErrors } from "../settings.profile.helpers";

function errorsFor(body: unknown) {
  const result = updateProfileSchema.safeParse(body);
  if (result.success) throw new Error("expected a validation failure");
  return profileFieldErrors(result.error.issues);
}

describe("updateProfileSchema", () => {
  it("refuses each unknown key by name, including the removed salary range and picture", () => {
    const fields = errorsFor({ fullName: "A", salaryRange: "x", salaryRangeEncrypted: "x", profilePictureUrl: "/x" })
      .map(error => error.field).sort();
    expect(fields).toEqual(["profilePictureUrl", "salaryRange", "salaryRangeEncrypted"]);
  });

  it("accepts an NRC in the shared format, clears it when empty, and names a bad one without echoing it", () => {
    expect(updateProfileSchema.parse({ nrc: "123456/78/9" })).toEqual({ nrc: "123456/78/9" });
    expect(updateProfileSchema.parse({ nrc: "" })).toEqual({ nrc: null });
    for (const nrc of ["12345678", "123456/78/9/1", "abcdef/gh/i"]) {
      const errors = errorsFor({ nrc });
      expect(errors.map(error => error.field)).toEqual(["nrc"]);
      expect(JSON.stringify(errors).includes(nrc)).toBe(false);
    }
  });

  describe.each(["readonly", "hidden"] as const)("NRC in %s mode", mode => {
    const schema = profileUpdateSchemaFor(mode);
    it.each([["null", null], ["an empty string", ""], ["a value", "123456/78/9"]])(
      "refuses %s, so a stored NRC cannot be changed or cleared", (_label, nrc) => {
        const result = schema.safeParse({ nrc });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(profileFieldErrors(result.error.issues)).toEqual([
            expect.objectContaining({ field: "nrc", message: NRC_NOT_EDITABLE_MESSAGE }),
          ]);
        }
      });
    it("still saves other fields when no NRC key is sent", () => {
      expect(schema.parse({ fullName: "A" })).toEqual({ fullName: "A" });
    });
  });

  it("NRC in editable mode: null and empty string clear it, a value is kept", () => {
    const schema = profileUpdateSchemaFor("editable");
    expect(schema.parse({ nrc: null })).toEqual({ nrc: null });
    expect(schema.parse({ nrc: "" })).toEqual({ nrc: null });
    expect(schema.parse({ nrc: "123456/78/9" })).toEqual({ nrc: "123456/78/9" });
  });

  it("refuses unknown nested address and social link keys", () => {
    const fields = errorsFor({ address: { country: "ZM", street: "old" }, socialLinks: { instagram: "x" } })
      .map(error => error.field).sort();
    expect(fields).toEqual(["address.street", "socialLinks.instagram"]);
  });

  it("names invalid values without repeating them", () => {
    const errors = errorsFor({ gender: "secret-gender", annualIncome: "1,000.00", phoneNumberMobile: "12345" });
    expect(errors.map(error => error.field).sort()).toEqual(["annualIncome", "gender", "phoneNumberMobile"]);
    const text = JSON.stringify(errors);
    for (const value of ["secret-gender", "1,000.00", "12345"]) expect(text.includes(value)).toBe(false);
  });

  it.each(["-1", "1.234", "1e5", "12345678901234"])("rejects annual income %s", value => {
    expect(updateProfileSchema.safeParse({ annualIncome: value }).success).toBe(false);
  });

  it("accepts only a real calendar date as YYYY-MM-DD for birthday", () => {
    expect(updateProfileSchema.safeParse({ birthday: "1990-05-15" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ birthday: "2025-02-30" }).success).toBe(false);
    // A datetime would be cast to its UTC day: 15 May picked in Lusaka arrives as the 14th.
    expect(updateProfileSchema.safeParse({ birthday: "1990-05-14T22:00:00.000Z" }).success).toBe(false);
  });

  it("stores cleared optional values as null", () => {
    const parsed = updateProfileSchema.parse({
      phoneNumberWork: "", phoneNumberHome: "", annualIncome: "", employmentStatus: "", investmentGoal: "", riskTolerance: "",
    });
    expect(Object.values(parsed)).toEqual([null, null, null, null, null, null]);
  });
});

describe("rules shared with the client form (shared/profile-policy.ts)", () => {
  afterEach(() => { vi.useRealTimers(); });
  const messageFor = (body: unknown) => {
    const result = updateProfileSchema.safeParse(body);
    return result.success ? null : result.error.issues.map(issue => issue.message);
  };

  it("refuses empty first and last names, as the form does", () => {
    expect(messageFor({ firstName: "", lastName: "" })).toEqual(["First name is required", "Last name is required"]);
    expect(messageFor({ firstName: "Ada", lastName: "Banda" })).toBeNull();
  });

  it("refuses a future or under-18 birthday by calendar day", () => {
    vi.useFakeTimers();
    // 12:00Z on 15 June: the latest calendar day anywhere (UTC+14) is 16 June.
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    expect(messageFor({ birthday: "2030-01-01" })).toEqual(["Birthday cannot be in the future"]);
    expect(messageFor({ birthday: "2026-06-17" })).toEqual(["Birthday cannot be in the future"]);
    expect(messageFor({ birthday: "2016-06-15" })).toEqual(["You must be at least 18 years old"]);
    expect(messageFor({ birthday: "2008-06-17" })).toEqual(["You must be at least 18 years old"]);
    // Turns 18 today somewhere on Earth, so a form in that zone accepts it.
    expect(messageFor({ birthday: "2008-06-16" })).toBeNull();
    expect(messageFor({ birthday: "1990-05-15" })).toBeNull();
  });

  it("applies the 18th birthday of a 29 February birth on 1 March", () => {
    const birthday = { year: 2008, month: 2, day: 29 };
    expect(birthdayProblem(birthday, { year: 2026, month: 2, day: 28 })).toBe("underage");
    expect(birthdayProblem(birthday, { year: 2026, month: 3, day: 1 })).toBeNull();
    expect(birthdayProblem(birthday, { year: 2008, month: 2, day: 28 })).toBe("future");
  });

  it("caps social links at the shared maximum", () => {
    const at = (length: number) => `https://example.test/${"a".repeat(length - "https://example.test/".length)}`;
    expect(messageFor({ socialLinks: { website: at(PROFILE_SOCIAL_LINK_MAX_LENGTH) } })).toBeNull();
    expect(messageFor({ socialLinks: { website: at(PROFILE_SOCIAL_LINK_MAX_LENGTH + 1) } }))
      .toEqual([`Link cannot exceed ${PROFILE_SOCIAL_LINK_MAX_LENGTH} characters`]);
  });

  it("accepts only a two-letter country code", () => {
    expect(messageFor({ address: { country: "ZM" } })).toBeNull();
    for (const country of ["1!", "<>", "Z", "ZMB"]) {
      expect(messageFor({ address: { country } })).toEqual(["Country code must be 2 letters"]);
    }
  });
});

describe("changedProfileFields", () => {
  it("lists only submitted fields whose stored value changed", () => {
    const before = { occupation: "A", address: { city: "Lusaka", country: "ZM" }, annualIncome: "10.00" } as User;
    const after = { occupation: "B", address: { country: "ZM", city: "Lusaka" }, annualIncome: "10.00" } as User;
    expect(changedProfileFields(before, after, { occupation: "B", address: { country: "ZM", city: "Lusaka" }, annualIncome: "10.00" }))
      .toEqual(["occupation"]);
  });
});
