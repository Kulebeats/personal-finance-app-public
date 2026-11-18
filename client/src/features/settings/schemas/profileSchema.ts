import { z } from "zod";

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
    .length(2, "Country code must be 2 characters")
    .default("ZM"), // ISO 3166-1 alpha-2
});

export const profileSchema = z.object({
  fullName: z
    .string()
    .min(1, "Full name is required")
    .max(100, "Name cannot exceed 100 characters"),

  firstName: z
    .string()
    .min(1, "First name is required")
    .max(50, "First name cannot exceed 50 characters"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(50, "Last name cannot exceed 50 characters"),
  displayName: z
    .string()
    .max(50, "Display name cannot exceed 50 characters")
    .optional(),

  birthday: z
    .date({
      required_error: "Date of birth is required",
      invalid_type_error: "Date of birth is required",
    })
    .refine(
      (date) => !date || date <= new Date(),
      "Birthday cannot be in the future"
    )
    .refine((date) => {
      if (!date) return true;
      const today = new Date();
      const minAgeDate = new Date(
        today.getFullYear() - 18,
        today.getMonth(),
        today.getDate()
      );
      return date <= minAgeDate;
    }, "You must be at least 18 years old")
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

  annualIncome: z.string().optional(),

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

  salaryRange: z.string().optional(),

  profilePicture: z.string().optional().or(z.literal("")),

  // Rich profile fields (Phase 2)
  bannerUrl: z.string().optional().or(z.literal("")),

  bio: z.string().max(1000, "Bio cannot exceed 1000 characters").optional(),

  socialLinks: z
    .object({
      linkedin: z
        .string()
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
        .email("Invalid email address")
        .optional()
        .or(z.literal("")),
      website: z
        .string()
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
    .max(20, "NRC cannot exceed 20 characters")
    .optional()
    .or(z.literal(""))
    .refine((val) => {
      if (!val || val === "") return true;
      return /^\d{6}\/\d{2}\/\d$/.test(val);
    }, "Invalid NRC format. Expected format: 123456/78/9"),
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
