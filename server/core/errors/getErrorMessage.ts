/**
 * Narrow an unknown thrown value to a human-readable message.
 *
 * Replaces the loosely-typed catch antipattern (annotating the caught value as
 * `any` and reading `.message` off it) with a type-safe equivalent: caught
 * values are `unknown`, and only `Error` instances are guaranteed to carry a
 * `.message`. Behaviour matches the previous code for the common case (an
 * `Error` was thrown) and is more robust for the rest.
 *
 * @module core/errors/getErrorMessage
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
