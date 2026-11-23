import { z } from "zod";
import {
  COUNTRY_CODE_MESSAGE,
  COUNTRY_CODE_PATTERN,
  FIRST_NAME_REQUIRED_MESSAGE,
  LAST_NAME_REQUIRED_MESSAGE,
  NRC_FORMAT_MESSAGE,
  NRC_MAX_LENGTH,
  NRC_PATTERN,
  PROFILE_FULL_NAME_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_SOCIAL_EMAIL_MAX_LENGTH,
  PROFILE_SOCIAL_LINK_MAX_LENGTH,
  SOCIAL_EMAIL_TOO_LONG_MESSAGE,
  SOCIAL_LINK_TOO_LONG_MESSAGE,
  birthdayProblem,
  birthdayProblemMessage,
} from "@shared/profile-policy";

/**
 * Profile validation schema using Zod
 *
 * Validates all profile fields with appropriate constraints:
 * - Full name is required
 * - Phone numbers must match Zambian format (+260XXXXXXXXX)
 * - Birthday cannot be in the future, user must be 18+
 * - All optional fields have sensible defaults
 */

// Zambian phone number regex: Either 9 digits OR +260 followed by 9 digits
// This allows users to enter just "967237128" when country selector shows +260
const zambianPhoneRegex = /^(\+260[0-9]{9}|[0-9]{9}|[0][0-9]{9})$/;

// Birthday rules shared with the server (shared/profile-policy.ts), checked on
// the local calendar day the picker shows.
function localBirthdayProblem(date: Date) {
  const today = new Date();
  return birthdayProblem(
    { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() },
    { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() }
  );
}

// Address sub-schema - Global standard
const addressSchema = z.object({
  addressLine1: z
    .string()
    .max(200, "Address cannot exceed 200 characters")
    .optional()
    .or(z.literal("")),
  addressLine2: z.string().max(200).optional(),
  city: z
    .string()
    .max(100, "City cannot exceed 100 characters")
    .optional()
    .or(z.literal("")),
  state: z.string().max(100).optional(), // Province/Region/County
  postalCode: z.string().max(20).optional(), // ZIP/Postcode/PIN - validation done elsewhere
  country: z
    .string()
    .regex(COUNTRY_CODE_PATTERN, COUNTRY_CODE_MESSAGE)
    .default("ZM"), // ISO 3166-1 alpha-2
});

export const profileSchema = z.object({
  fullName: z
    .string()
    .min(1, "Full name is required")
    .max(PROFILE_FULL_NAME_MAX_LENGTH, "Name cannot exceed 100 characters"),

  firstName: z
    .string()
    .min(1, FIRST_NAME_REQUIRED_MESSAGE)
    .max(PROFILE_NAME_MAX_LENGTH, "First name cannot exceed 50 characters"),
  lastName: z
    .string()
    .min(1, LAST_NAME_REQUIRED_MESSAGE)
    .max(PROFILE_NAME_MAX_LENGTH, "Last name cannot exceed 50 characters"),
  displayName: z
    .string()
    .max(PROFILE_NAME_MAX_LENGTH, "Display name cannot exceed 50 characters")
    .optional(),

  birthday: z
    .date({
      required_error: "Date of birth is required",
      invalid_type_error: "Date of birth is required",
    })
    .superRefine((date, ctx) => {
      const problem = date ? localBirthdayProblem(date) : null;
      if (problem) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: birthdayProblemMessage(problem) });
      }
    })
    .nullable(),

  birthdayHideYear: z.boolean().default(false),

  timezone: z.string().default("Africa/Lusaka"),

  gender: z.enum(["male", "female"], {
    required_error: "Gender is required",
    invalid_type_error: "Gender is required",
  }),

  phoneNumberMobile: z
    .string()
    .regex(
      zambianPhoneRegex,
      "Invalid Zambian phone number format (+260XXXXXXXXX)"
    )
    .optional()
    .or(z.literal("")),

  phoneNumberWork: z
    .string()
    .regex(
      zambianPhoneRegex,
      "Invalid Zambian phone number format (+260XXXXXXXXX)"
    )
    .optional()
    .or(z.literal("")),
  phoneNumberHome: z.string().max(20).optional().or(z.literal("")),

  occupation: z.string().max(100).optional(),

  address: addressSchema,

  // Same rule as the server (users.annual_income is decimal(15, 2)).
  annualIncome: z
    .string()
    .regex(
      /^(\d{1,13}(\.\d{1,2})?)?$/,
      "Enter an amount like 15000 or 15000.50 (no commas, at most 2 decimals)"
    )
    .optional(),

  incomeFrequency: z
    .enum(["monthly", "bi-weekly", "annual"])
    .default("monthly"),

  employmentStatus: z
    .enum(["employed", "self-employed", "retired", "unemployed", "student", ""])
    .optional(),

  investmentGoal: z
    .enum([
      "retirement",
      "home_purchase",
      "wealth_growth",
      "education",
      "emergency_fund",
      "",
    ])
    .optional(),

  riskTolerance: z.enum(["low", "medium", "high", ""]).optional(),

  profilePicture: z.string().optional().or(z.literal("")),

  // Rich profile fields (Phase 2)
  bannerUrl: z.string().optional().or(z.literal("")),

  bio: z.string().max(1000, "Bio cannot exceed 1000 characters").optional(),

  socialLinks: z
    .object({
      linkedin: z
        .string()
        .max(PROFILE_SOCIAL_LINK_MAX_LENGTH, SOCIAL_LINK_TOO_LONG_MESSAGE)
        .refine(
          (val) =>
            !val ||
            val === "" ||
            /^(https?:\/\/)?(www\.)?linkedin\.com\/(in|company)\/[\w-]+\/?/.test(
              val
            ),
          "Must be a valid LinkedIn profile URL (e.g., linkedin.com/in/username)"
        )
        .optional()
        .or(z.literal("")),
      facebook: z
        .string()
        .max(PROFILE_SOCIAL_LINK_MAX_LENGTH, SOCIAL_LINK_TOO_LONG_MESSAGE)
        .refine(
          (val) =>
            !val ||
            val === "" ||
            /^(https?:\/\/)?(www\.)?(facebook\.com|fb\.com)\/[\w.-]+\/?/.test(
              val
            ),
          "Must be a valid Facebook profile URL (e.g., facebook.com/username)"
        )
        .optional()
        .or(z.literal("")),
      twitter: z
        .string()
        .max(PROFILE_SOCIAL_LINK_MAX_LENGTH, SOCIAL_LINK_TOO_LONG_MESSAGE)
        .refine(
          (val) =>
            !val ||
            val === "" ||
            /^(https?:\/\/)?(www\.)?(twitter\.com|x\.com)\/[\w]+\/?/.test(val),
          "Must be a valid Twitter/X profile URL (e.g., twitter.com/username or x.com/username)"
        )
        .optional()
        .or(z.literal("")),
      github: z
        .string()
        .max(PROFILE_SOCIAL_LINK_MAX_LENGTH, SOCIAL_LINK_TOO_LONG_MESSAGE)
        .refine(
          (val) =>
            !val ||
            val === "" ||
            /^(https?:\/\/)?(www\.)?github\.com\/[\w-]+\/?/.test(val),
          "Must be a valid GitHub profile URL (e.g., github.com/username)"
        )
        .optional()
        .or(z.literal("")),
      email: z
        .string()
        .max(PROFILE_SOCIAL_EMAIL_MAX_LENGTH, SOCIAL_EMAIL_TOO_LONG_MESSAGE)
        .email("Invalid email address")
        .optional()
        .or(z.literal("")),
      website: z
        .string()
        .max(PROFILE_SOCIAL_LINK_MAX_LENGTH, SOCIAL_LINK_TOO_LONG_MESSAGE)
        .url("Invalid website URL")
        .optional()
        .or(z.literal("")),
    })
    .default({
      linkedin: "",
      facebook: "",
      twitter: "",
      github: "",
      email: "",
      website: "",
    }),

  nrc: z
    .string()
    .max(NRC_MAX_LENGTH, "NRC cannot exceed 20 characters")
    .optional()
    .or(z.literal(""))
    .refine((val) => !val || NRC_PATTERN.test(val), NRC_FORMAT_MESSAGE),
});

export type ProfileFormData = z.infer<typeof profileSchema>;

// Helper to create default profile data
export const defaultProfileData: Partial<ProfileFormData> = {
  fullName: "",
  timezone: "Africa/Lusaka",
  incomeFrequency: "monthly",
  birthdayHideYear: false,
  gender: undefined,
  employmentStatus: "",
  investmentGoal: "",
  riskTolerance: "",
  address: {
    addressLine1: "",
    city: "",
    country: "ZM",
  },
  socialLinks: {
    linkedin: "",
    facebook: "",
    twitter: "",
    github: "",
    email: "",
    website: "",
  },
};
