/**
 * Own-profile update helpers: safe validation messages and the changed-field
 * list recorded in the audit row.
 *
 * The profile holds phone numbers, address, income and similar personal data,
 * so neither the 400 response nor the audit row may echo submitted values.
 */
import { isDeepStrictEqual } from "node:util";
import type { ZodIssue } from "zod";
import type { User } from "@shared/schema";
import type { FieldError } from "../../core/errors";
import { nrcForStorage } from "../../core/personal-data/nrc";
import type { UpdateProfileInput } from "./settings.profile.validation";

/**
 * Field errors that name the offending field but never repeat its value.
 * An unknown key gets one error per key, named by its path.
 */
export function profileFieldErrors(issues: ZodIssue[]): FieldError[] {
  return issues.flatMap((issue): FieldError[] => {
    const base = issue.path.join(".");
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map(key => ({
        field: base ? `${base}.${key}` : key,
        message: "Unknown profile field; it cannot be saved",
        code: issue.code,
      }));
    }
    // Zod's default enum message repeats the received value.
    const message = issue.code === "invalid_enum_value"
      ? `Expected one of: ${issue.options.join(", ")}`
      : issue.message;
    return [{ field: base || "body", message, code: issue.code }];
  });
}

/** The users row values for a validated update; the NRC goes through its storage accessor. */
export function profileForStorage(input: UpdateProfileInput): UpdateProfileInput {
  if (input.nrc === undefined) return input;
  return { ...input, nrc: nrcForStorage(input.nrc) };
}

/** Names of the submitted fields whose stored value actually changed. */
export function changedProfileFields(
  before: User,
  after: User,
  submitted: UpdateProfileInput,
): string[] {
  const keys = Object.keys(submitted) as Array<keyof UpdateProfileInput>;
  return keys.filter(key => !isDeepStrictEqual(before[key], after[key])).sort();
}
