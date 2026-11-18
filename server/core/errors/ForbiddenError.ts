/**
 * Forbidden Error (403)
 *
 * @module core/errors/ForbiddenError
 */

import { HttpError } from "./HttpError";

export class ForbiddenError extends HttpError {
  readonly statusCode = 403;
  readonly code = "FORBIDDEN";

  constructor(message: string = "Access denied") {
    super(message);
  }
}
