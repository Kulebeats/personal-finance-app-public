import { describe, expect, it } from "vitest";
import { buildProfileChecklist } from "../ProfileCompletenessWidget";
import type { ProfileFormData } from "@/features/settings/schemas/profileSchema";

const everythingButSocialLinks = {
  fullName: "Test User",
  phoneNumberMobile: "967237128",
  occupation: "Engineer",
  address: { addressLine1: "House 2", city: "Lusaka" },
  investmentGoal: "retirement",
  annualIncome: "1000000",
  profilePicture: "https://example.test/p.png",
  bio: "A short bio about me",
} as unknown as ProfileFormData;

describe("buildProfileChecklist", () => {
  it("reaches 100% without social links, which are optional", () => {
    const checklist = buildProfileChecklist(everythingButSocialLinks);

    expect(checklist.progress).toBe(100);
    const social = checklist.items.find((item) => item.id === "socialLinks");
    expect(social?.optional).toBe(true);
    expect(social?.completed).toBe(false);
  });

  it("still counts a missing required item", () => {
    const checklist = buildProfileChecklist({
      ...everythingButSocialLinks,
      occupation: "",
    } as ProfileFormData);

    expect(checklist.progress).toBe(88); // 7 of 8 required items
  });
});
