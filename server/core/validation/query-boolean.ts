import { z } from "zod";

/**
 * A boolean flag read from a query string or a form body (NEW-36).
 *
 * `z.coerce.boolean()` runs JS `Boolean(value)`, so the string "false" becomes TRUE and any
 * non-empty word passes. This schema reads exactly "true" and "false" (and real booleans
 * from a JSON body) and refuses everything else with a validation error.
 *
 * @example
 * includeArchived: strictBooleanSchema.default(false)
 */
export const strictBooleanSchema = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean({ invalid_type_error: 'Expected "true" or "false"' }),
);
