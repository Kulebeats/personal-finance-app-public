/**
 * Own-profile update validation (PUT /api/settings/profile).
 *
 * Mirrors the rules of client/src/features/settings/schemas/profileSchema.ts
 * for every field the profile form saves. The object is strict: a key that is
 * not listed here is refused with a 400 naming it, never silently dropped.
 *
 * NRC (AH-07) is accepted only while NRC_FIELD_MODE is "editable"; it is
 * stored through server/core/personal-data/nrc.ts.
 *
 * Deliberately NOT accepted:
 * - salaryRange: removed (AH-07), the column is dropped.
 * - profilePicture / profilePictureUrl / bannerUrl: set only by the upload
 *   endpoints, which validate the file and own the stored path.
 */
import { z } from "zod";
import {
  COUNTRY_CODE_MESSAGE,
  COUNTRY_CODE_PATTERN,
  FIRST_NAME_REQUIRED_MESSAGE,
  LAST_NAME_REQUIRED_MESSAGE,
  NRC_FIELD_MODE,
  NRC_FORMAT_MESSAGE,
  NRC_MAX_LENGTH,
  NRC_NOT_EDITABLE_MESSAGE,
  NRC_PATTERN,
  PROFILE_FULL_NAME_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_SOCIAL_EMAIL_MAX_LENGTH,
  PROFILE_SOCIAL_LINK_MAX_LENGTH,
  SOCIAL_EMAIL_TOO_LONG_MESSAGE,
  SOCIAL_LINK_TOO_LONG_MESSAGE,
  birthdayProblem,
  birthdayProblemMessage,
  type CalendarDay,
  type ProfileFieldMode,
} from "@shared/profile-policy";

// Same pattern as the client: +260 and 9 digits, 9 digits, or 0 and 9 digits.
const ZAMBIAN_PHONE = /^(\+260[0-9]{9}|[0-9]{9}|[0][0-9]{9})$/;
const PHONE_MESSAGE = "Invalid Zambian phone number format (+260XXXXXXXXX)";
// users.annual_income is decimal(15, 2): up to 13 integer digits, 2 decimals.
const ANNUAL_INCOME = /^\d{1,13}(\.\d{1,2})?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// The latest calendar day anywhere (UTC+14). The client checks against the
// user's local day, which is never later than this, so a birthday the form
// accepts is never refused here.
const LATEST_ZONE_OFFSET_MS = 14 * 60 * 60 * 1000;

const LINKEDIN = /^(https?:\/\/)?(www\.)?linkedin\.com\/(in|company)\/[\w-]+\/?/;
const FACEBOOK = /^(https?:\/\/)?(www\.)?(facebook\.com|fb\.com)\/[\w.-]+\/?/;
const TWITTER = /^(https?:\/\/)?(www\.)?(twitter\.com|x\.com)\/[\w]+\/?/;
const GITHUB = /^(https?:\/\/)?(www\.)?github\.com\/[\w-]+\/?/;

function emptyToNull<T extends string>(value: T): Exclude<T, ""> | null {
  return value === "" ? null : (value as Exclude<T, "">);
}

/**
 * A calendar date "YYYY-MM-DD" that exists (rejects 2025-02-30), as its parts.
 * A datetime is refused: casting one to `date` keeps its UTC day, which
 * shifted Lusaka birthdays back a day on every save.
 */
function parseCalendarDay(value: string): CalendarDay | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return { year: parseInt(match[1], 10), month: parseInt(match[2], 10), day: parseInt(match[3], 10) };
}

function latestCalendarToday(now: Date): CalendarDay {
  const shifted = new Date(now.getTime() + LATEST_ZONE_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Same rules as the client: a real date, not in the future, at least 18 years ago. */
const birthdaySchema = z.string().superRefine((value, ctx) => {
  const birthday = parseCalendarDay(value);
  if (!birthday) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Birthday must be a valid date in YYYY-MM-DD form" });
    return;
  }
  const problem = birthdayProblem(birthday, latestCalendarToday(new Date()));
  if (problem) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: birthdayProblemMessage(problem) });
  }
});

const phoneSchema = z
  .string()
  .refine(value => value === "" || ZAMBIAN_PHONE.test(value), PHONE_MESSAGE)
  .transform(emptyToNull)
  .nullable()
  .optional();

/**
 * "" or null clears the NRC; a value must match the shared NRC format. Any
 * submitted NRC, null included, is refused unless the mode is "editable"; the
 * mode check sits outside .nullable() so a null cannot skip it. An absent key
 * changes nothing and passes in every mode.
 */
export function nrcSchemaFor(mode: ProfileFieldMode) {
  return z
    .string()
    .max(NRC_MAX_LENGTH, NRC_FORMAT_MESSAGE)
    .refine(value => value === "" || NRC_PATTERN.test(value), NRC_FORMAT_MESSAGE)
    .nullable()
    .refine(() => mode === "editable", NRC_NOT_EDITABLE_MESSAGE)
    .transform(value => (value === "" ? null : value))
    .optional();
}

const linkSchema = (pattern: RegExp, message: string) =>
  z.string()
    .max(PROFILE_SOCIAL_LINK_MAX_LENGTH, SOCIAL_LINK_TOO_LONG_MESSAGE)
    .refine(value => value === "" || pattern.test(value), message)
    .optional();

const profileAddressSchema = z
  .object({
    addressLine1: z.string().max(200, "Address cannot exceed 200 characters").optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(100, "City cannot exceed 100 characters").optional(),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().regex(COUNTRY_CODE_PATTERN, COUNTRY_CODE_MESSAGE),
  })
  .strict();

const socialLinksSchema = z
  .object({
    linkedin: linkSchema(LINKEDIN, "Must be a valid LinkedIn profile URL"),
    facebook: linkSchema(FACEBOOK, "Must be a valid Facebook profile URL"),
    twitter: linkSchema(TWITTER, "Must be a valid Twitter/X profile URL"),
    github: linkSchema(GITHUB, "Must be a valid GitHub profile URL"),
    email: z
      .string()
      .max(PROFILE_SOCIAL_EMAIL_MAX_LENGTH, SOCIAL_EMAIL_TOO_LONG_MESSAGE)
      .refine(value => value === "" || z.string().email().safeParse(value).success, "Invalid email address")
      .optional(),
    website: z
      .string()
      .max(PROFILE_SOCIAL_LINK_MAX_LENGTH, SOCIAL_LINK_TOO_LONG_MESSAGE)
      .refine(value => value === "" || z.string().url().safeParse(value).success, "Invalid website URL")
      .optional(),
  })
  .strict();

/** The own-profile update schema with NRC writes allowed or refused by `nrcMode`. */
export function profileUpdateSchemaFor(nrcMode: ProfileFieldMode) {
  return z
    .object({
      fullName: z.string().min(1).max(PROFILE_FULL_NAME_MAX_LENGTH).optional(),
      firstName: z.string().min(1, FIRST_NAME_REQUIRED_MESSAGE).max(PROFILE_NAME_MAX_LENGTH).optional(),
      lastName: z.string().min(1, LAST_NAME_REQUIRED_MESSAGE).max(PROFILE_NAME_MAX_LENGTH).optional(),
      displayName: z.string().max(PROFILE_NAME_MAX_LENGTH).optional(),
      birthday: birthdaySchema.nullable().optional(),
      birthdayHideYear: z.boolean().optional(),
      timezone: z.string().max(50).optional(),
      bio: z.string().max(1000).optional(),
      gender: z.enum(["male", "female"]).optional(),
      phoneNumberMobile: phoneSchema,
      phoneNumberWork: phoneSchema,
      phoneNumberHome: z.string().max(20).transform(emptyToNull).nullable().optional(),
      occupation: z.string().max(100).optional(),
      address: profileAddressSchema.optional(),
      annualIncome: z
        .string()
        .refine(
          value => value === "" || ANNUAL_INCOME.test(value),
          "Annual income must be a non-negative amount with at most 2 decimal places",
        )
        .transform(emptyToNull)
        .nullable()
        .optional(),
      incomeFrequency: z.enum(["monthly", "bi-weekly", "annual"]).optional(),
      employmentStatus: z
        .enum(["employed", "self-employed", "retired", "unemployed", "student", ""])
        .transform(emptyToNull)
        .nullable()
        .optional(),
      investmentGoal: z
        .enum(["retirement", "home_purchase", "wealth_growth", "education", "emergency_fund", ""])
        .transform(emptyToNull)
        .nullable()
        .optional(),
      riskTolerance: z.enum(["low", "medium", "high", ""]).transform(emptyToNull).nullable().optional(),
      nrc: nrcSchemaFor(nrcMode),
      socialLinks: socialLinksSchema.optional(),
    })
    .strict();
}

export const updateProfileSchema = profileUpdateSchemaFor(NRC_FIELD_MODE);

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
