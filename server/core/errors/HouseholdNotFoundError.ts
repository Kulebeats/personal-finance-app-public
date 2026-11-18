/**
 * Household Not Found Error (404)
 *
 * Distinguishes "the authenticated user has no household yet" (the new-user
 * onboarding gate) from a generic resource-not-found. NotFoundError's `code`
 * is the shared "NOT_FOUND" used for every resource type, so a client cannot
 * reliably branch on it alone without also depending on prose in `message` -
 * which is exactly the bug this error fixes (see client Dashboard.tsx).
 *
 * The default message is kept identical to the historical NotFoundError text
 * ("No household found") for backward compatibility - older clients that
 * still substring-match on the message keep working unchanged, while newer
 * clients can key off the structural `code` instead.
 *
 * @module core/errors/HouseholdNotFoundError
 */

import { HttpError } from "./HttpError";

export class HouseholdNotFoundError extends HttpError {
  readonly statusCode = 404;
  readonly code = "HOUSEHOLD_NOT_FOUND";

  constructor(message: string = "No household found") {
    super(message);
  }
}
