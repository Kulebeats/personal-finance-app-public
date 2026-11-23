import { HttpError } from "./HttpError";

/** A rejected credential challenge does not imply the current session expired. */
export class InvalidCredentialsError extends HttpError {
  readonly statusCode = 401;
  readonly code = "INVALID_CREDENTIALS";
}
