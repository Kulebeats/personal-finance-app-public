import { z } from "zod";
import {
  PASSWORD_CHARACTER_RULES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MAX_LENGTH_MESSAGE,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MIN_LENGTH_MESSAGE,
} from "@shared/password-policy";

/**
 * One policy for registration, reset and authenticated password changes.
 * The rules live in shared/password-policy.ts so the client checklist reads
 * the same definition.
 */
export const passwordPolicySchema = PASSWORD_CHARACTER_RULES.reduce(
  (schema, rule) => schema.regex(rule.pattern, rule.message),
  z.string()
    .min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH_MESSAGE)
    .max(PASSWORD_MAX_LENGTH, PASSWORD_MAX_LENGTH_MESSAGE),
);
