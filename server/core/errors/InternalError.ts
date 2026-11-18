/**
 * Internal Error (500)
 *
 * @module core/errors/InternalError
 */

import { HttpError } from "./HttpError";

export class InternalError extends HttpError {
  readonly statusCode = 500;
  readonly code = "INTERNAL_ERROR";
  readonly isOperational = false; // Unexpected error

  constructor(message: string = "An unexpected error occurred") {
    super(message);
  }
}
