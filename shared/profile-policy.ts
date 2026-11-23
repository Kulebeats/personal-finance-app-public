/**
 * Single definition of the profile rules the client form and the server both
 * enforce (PUT /api/settings/profile), so a value one side accepts is never
 * refused by the other. Same pattern as shared/password-policy.ts.
 */

export const PROFILE_FULL_NAME_MAX_LENGTH = 100;
export const PROFILE_NAME_MAX_LENGTH = 50;
export const PROFILE_SOCIAL_LINK_MAX_LENGTH = 500;
export const PROFILE_SOCIAL_EMAIL_MAX_LENGTH = 255;
export const PROFILE_MIN_AGE_YEARS = 18;

export const FIRST_NAME_REQUIRED_MESSAGE = "First name is required";
export const LAST_NAME_REQUIRED_MESSAGE = "Last name is required";
export const SOCIAL_LINK_TOO_LONG_MESSAGE = `Link cannot exceed ${PROFILE_SOCIAL_LINK_MAX_LENGTH} characters`;
export const SOCIAL_EMAIL_TOO_LONG_MESSAGE = `Email cannot exceed ${PROFILE_SOCIAL_EMAIL_MAX_LENGTH} characters`;
export const BIRTHDAY_FUTURE_MESSAGE = "Birthday cannot be in the future";
export const BIRTHDAY_MIN_AGE_MESSAGE = `You must be at least ${PROFILE_MIN_AGE_YEARS} years old`;
/** ISO 3166-1 alpha-2 shape: exactly two letters. */
export const COUNTRY_CODE_PATTERN = /^[A-Za-z]{2}$/;
export const COUNTRY_CODE_MESSAGE = "Country code must be 2 letters";

/** Zambian National Registration Card number: 123456/78/9 (users.nrc is varchar(20)). */
export const NRC_PATTERN = /^\d{6}\/\d{2}\/\d$/;
export const NRC_MAX_LENGTH = 20;
export const NRC_FORMAT_MESSAGE = "Invalid NRC format. Expected format: 123456/78/9";
export const NRC_NOT_EDITABLE_MESSAGE = "NRC cannot be changed at the moment";

/**
 * How the profile shows the NRC (AH-07, OI-04 proposal). "editable" collects
 * it; "readonly" greys the saved value out; "hidden" removes the field. The
 * server accepts an NRC write only while it is "editable". Change it here to
 * grey out or hide NRC for everyone; the form and the server both follow.
 */
export type ProfileFieldMode = "editable" | "readonly" | "hidden";
export const NRC_FIELD_MODE: ProfileFieldMode = "editable";

/** A calendar day by its parts; month is 1-12. No time and no time zone. */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

export type BirthdayProblem = "future" | "underage";

function compareDays(a: CalendarDay, b: CalendarDay): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Why a birthday is refused relative to `today`, or null when it is allowed.
 * Pure calendar arithmetic: someone born on 29 February turns 18 on 1 March
 * in a non-leap year (their 28 February is still before the anniversary).
 */
export function birthdayProblem(birthday: CalendarDay, today: CalendarDay): BirthdayProblem | null {
  if (compareDays(birthday, today) > 0) return "future";
  const anniversary = { year: birthday.year + PROFILE_MIN_AGE_YEARS, month: birthday.month, day: birthday.day };
  return compareDays(anniversary, today) > 0 ? "underage" : null;
}

export function birthdayProblemMessage(problem: BirthdayProblem): string {
  return problem === "future" ? BIRTHDAY_FUTURE_MESSAGE : BIRTHDAY_MIN_AGE_MESSAGE;
}
