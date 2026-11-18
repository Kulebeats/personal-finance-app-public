/**
 * Unauthorized Error (401)
 *
 * @module core/errors/UnauthorizedError
 */

import { HttpError } from "./HttpError";

export class UnauthorizedError extends HttpError {
  readonly statusCode = 401;
  readonly code = "UNAUTHORIZED";

  constructor(message: string = "Authentication required") {
    super(message);
  }
}
