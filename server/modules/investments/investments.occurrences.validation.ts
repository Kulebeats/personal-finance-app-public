import { z } from "zod";
import { normalizeHouseholdTimeZone } from "@shared/household-calendar";
import { canonicalSipOccurrenceDate, normalizeSipOccurrenceConfirmation,
  SipOccurrenceContractError } from "@shared/sip-occurrence-contract";

const date = z.string().refine(value => {
  try {
    canonicalSipOccurrenceDate(value, "date");
    return true;
  } catch {
    return false;
  }
}, "Use a real date in YYYY-MM-DD format");
const uuid = z.string().length(36).uuid().transform(value => value.toLowerCase());

export const sipOccurrencePlanPathSchema = z.object({ planId: uuid });
export const sipOccurrenceConfirmationPathSchema = z.object({ planId: uuid, scheduledDate: date });
export const sipOccurrenceListQuerySchema = z.object({
  state: z.enum(["all", "pending", "closed"]).default("all"),
  limit: z.coerce.number().int().positive().max(100).default(25),
  before: date.optional(),
}).strict();
export const sipOccurrenceCalendarSchema = z.object({
  timeZone: z.string().transform((value, context) => {
    try {
      return normalizeHouseholdTimeZone(value);
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Select a supported named household time zone." });
      return z.NEVER;
    }
  }),
}).strict();

/** The shared parser is the wire authority; Zod supplies the standard safeParse
 * controller boundary and bounded field errors without echoing input values. */
export const sipOccurrenceConfirmationSchema = z.unknown().transform((input, context) => {
  try {
    return normalizeSipOccurrenceConfirmation(input);
  } catch (error) {
    if (!(error instanceof SipOccurrenceContractError)) throw error;
    for (const field of error.fields) {
      context.addIssue({ code: z.ZodIssueCode.custom,
        path: field.path ? field.path.split(".") : [], message: field.message });
    }
    return z.NEVER;
  }
});
