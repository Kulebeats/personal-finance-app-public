/**
 * Conflict Error (409)
 *
 * @module core/errors/ConflictError
 */

import { HttpError } from "./HttpError";

export class ConflictError extends HttpError {
  readonly statusCode = 409;
  readonly code = "CONFLICT";
  readonly existingId?: string;

  constructor(message: string, existingId?: string) {
    super(message);
    this.existingId = existingId;
  }
}
